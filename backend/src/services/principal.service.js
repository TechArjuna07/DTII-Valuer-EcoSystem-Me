import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { redis } from '../database/redis.js';
import { ROLES } from '../config/rbac.js';
import { effectivePermissions } from './permissions.service.js';

/**
 * Resolves the authenticated principal for a session + firm context, from the DATABASE (the JWT carries ids only):
 *   { userId, sessionId, firmId, isSuperadmin, roles[], permissions[], email, fullName, employeeId, clientId, firm }
 * Returns null when the session, user, firm or membership is no longer valid.
 * Cached for 30 s per session; deactivation / role changes call invalidate*Principals() for immediate effect.
 */
const TTL_SECONDS = 30;
const key = (sessionId) => `${env.QUEUE_PREFIX}:principal:${sessionId}`;

/**
 * The roles a user can actually exercise in a firm right now:
 *  - firm ACTIVE, user_role ACTIVE
 *  - staff roles need an ACTIVE employee profile; CLIENT needs an ACTIVE client record linked to the user
 * @returns {Promise<null | { firm: {id,name,firmCode}, roles: string[], employeeId: string|null, clientId: string|null }>}
 */
async function resolveFirmAccess(userId, firmId, db = prisma) {
  const firm = await db.organization.findFirst({ where: { id: firmId, status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true, firmCode: true } });
  if (!firm) return null;
  const rows = await db.userRole.findMany({
    where: { userId, firmId, status: 'ACTIVE' },
    select: { role: { select: { code: true, sortOrder: true } } },
  });
  let roles = rows.sort((a, b) => a.role.sortOrder - b.role.sortOrder).map((r) => r.role.code);

  const employee = await db.employeeProfile.findUnique({ where: { firmId_userId: { firmId, userId } }, select: { id: true, status: true, deletedAt: true } });
  const employeeActive = !!employee && employee.status === 'ACTIVE' && !employee.deletedAt;
  if (!employeeActive) roles = roles.filter((r) => r === ROLES.CLIENT);

  let clientId = null;
  if (roles.includes(ROLES.CLIENT)) {
    const client = await db.client.findUnique({ where: { firmId_userId: { firmId, userId } }, select: { id: true, status: true, deletedAt: true } });
    if (client && client.status === 'ACTIVE' && !client.deletedAt) clientId = client.id;
    else roles = roles.filter((r) => r !== ROLES.CLIENT);
  }
  if (!roles.length) return null;
  return { firm, roles, employeeId: employeeActive ? employee.id : null, clientId };
}

/** Every firm context a user can currently sign in to. */
async function listFirmAccess(userId) {
  const firmIds = await prisma.userRole.findMany({ where: { userId, status: 'ACTIVE' }, distinct: ['firmId'], select: { firmId: true } });
  const result = [];
  for (const { firmId } of firmIds) {
    const access = await resolveFirmAccess(userId, firmId);
    if (access) result.push(access);
  }
  return result.sort((a, b) => a.firm.name.localeCompare(b.firm.name));
}

async function loadPrincipalFromDb({ userId, sessionId, firmId }) {
  const session = await prisma.userSession.findUnique({ where: { id: sessionId }, select: { userId: true, firmId: true, familyId: true, revokedAt: true, expiresAt: true } });
  if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date() || (session.firmId ?? null) !== (firmId ?? null)) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') return null;

  const base = {
    userId,
    sessionId,
    familyId: session.familyId,
    firmId: firmId ?? null,
    isSuperadmin: user.isSuperadmin,
    email: user.email,
    fullName: user.fullName,
    employeeId: null,
    clientId: null,
    firm: null,
  };

  if (!firmId) {
    if (!user.isSuperadmin) return null;
    return { ...base, roles: [ROLES.SUPER_ADMIN], permissions: await effectivePermissions(null, [ROLES.SUPER_ADMIN]) };
  }
  const access = await resolveFirmAccess(userId, firmId);
  if (!access) return null;
  return { ...base, ...access, permissions: await effectivePermissions(firmId, access.roles) };
}

async function loadPrincipal(claims) {
  try {
    const cached = await redis.get(key(claims.sessionId));
    if (cached) {
      const p = JSON.parse(cached);
      if (p.userId === claims.userId && (p.firmId ?? null) === (claims.firmId ?? null)) return p;
    }
  } catch {
    /* fall through to the database */
  }
  const principal = await loadPrincipalFromDb(claims);
  if (principal) await redis.set(key(claims.sessionId), JSON.stringify(principal), 'EX', TTL_SECONDS).catch(() => undefined);
  return principal;
}

async function dropCached(where) {
  const sessions = await prisma.userSession.findMany({ where, select: { id: true } });
  if (sessions.length) await redis.del(...sessions.map((s) => key(s.id))).catch(() => undefined);
}

/** Drops cached principals of every session of a user (after deactivation, role or password change). */
const invalidateUserPrincipals = (userId) => dropCached({ userId });
/** Drops cached principals of every session in a firm context (after suspension or RBAC changes). */
const invalidateFirmPrincipals = (firmId) => dropCached({ firmId });

export { loadPrincipal, loadPrincipalFromDb, resolveFirmAccess, listFirmAccess, invalidateUserPrincipals, invalidateFirmPrincipals };
