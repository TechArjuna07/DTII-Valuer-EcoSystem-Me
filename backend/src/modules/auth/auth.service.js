import { env } from '../../config/env.js';
import { redis } from '../../database/redis.js';
import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, HttpError, NotFound, Unauthorized } from '../../utils/errors.js';
import { hmac, sha256 } from '../../services/crypto.js';
import { burnPasswordCheck, hashPassword, needsRehash, passwordContainsEmail, verifyPassword } from '../../services/password.js';
import { signAccessToken } from '../../services/token.service.js';
import { AuditAction, recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { invalidateUserPrincipals, listFirmAccess, resolveFirmAccess } from '../../services/principal.service.js';
import { createSession, revokeAllUserSessions, revokeFamily } from './sessions.js';
import { createAndSendPasswordReset } from './invitations.js';

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_LINK = 'This link is invalid or has expired';
/** A rotated refresh token presented again within this window is treated as a concurrent tab, not theft. */
const REUSE_GRACE_MS = 10_000;

const meta = (req) => ({ ip: req?.ip ? String(req.ip).slice(0, 64) : null, userAgent: req?.headers?.['user-agent']?.slice(0, 400) ?? null });

/**
 * Picks the sign-in context: the requested firm if the user has access to it; otherwise the platform for a
 * Superadmin; otherwise the firm used most recently (or the first one alphabetically).
 */
async function chooseContext(user, requestedFirmId) {
  const firms = await listFirmAccess(user.id);
  if (requestedFirmId) {
    if (firms.some((f) => f.firm.id === requestedFirmId)) return requestedFirmId;
    if (!(user.isSuperadmin && requestedFirmId === 'platform')) throw Unauthorized('You do not have access to that firm');
  }
  if (user.isSuperadmin) return null;
  if (!firms.length) return undefined;
  const last = await prisma.userSession.findFirst({
    where: { userId: user.id, firmId: { in: firms.map((f) => f.firm.id) } },
    orderBy: { createdAt: 'desc' },
    select: { firmId: true },
  });
  return last?.firmId ?? firms[0].firm.id;
}

async function issueSessionTokens(user, firmId, req, familyId) {
  const { session, refreshToken } = await createSession({ userId: user.id, firmId, familyId, meta: meta(req) });
  return { session, refreshToken, accessToken: signAccessToken({ userId: user.id, sessionId: session.id, firmId }) };
}

/** Email + password login with per-account lockout. Every failure returns the same message. */
async function login({ email, password, firmId: requestedFirmId }, req) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.deletedAt) {
    await burnPasswordCheck(password);
    await recordAuditSafe({ action: AuditAction.LOGIN_FAILED, req, actorId: user?.id ?? null, firmId: null, meta: { reason: 'UNKNOWN_OR_NO_PASSWORD', emailHash: hmac(email) } });
    throw Unauthorized(INVALID_CREDENTIALS);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await burnPasswordCheck(password);
    await recordAuditSafe({ action: AuditAction.LOGIN_BLOCKED_LOCKED, req, actorId: user.id, firmId: null });
    throw Unauthorized(INVALID_CREDENTIALS);
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= env.LOGIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) } : { failedLoginCount: failures },
    });
    await recordAuditSafe({ action: lock ? AuditAction.ACCOUNT_LOCKED : AuditAction.LOGIN_FAILED, req, actorId: user.id, firmId: null, meta: { reason: 'BAD_PASSWORD' } });
    throw Unauthorized(INVALID_CREDENTIALS);
  }
  if (user.status !== 'ACTIVE') {
    await recordAuditSafe({ action: AuditAction.LOGIN_FAILED, req, actorId: user.id, firmId: null, meta: { reason: `STATUS_${user.status}` } });
    throw Unauthorized(INVALID_CREDENTIALS);
  }

  const firmId = await chooseContext(user, requestedFirmId);
  if (firmId === undefined) {
    await recordAuditSafe({ action: AuditAction.LOGIN_FAILED, req, actorId: user.id, firmId: null, meta: { reason: 'NO_ACTIVE_ACCESS' } });
    throw Unauthorized('Your account does not have active access. Contact your firm administrator.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      // Transparently upgrade hashes created with older parameters.
      ...(needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(password) } : {}),
    },
  });
  const tokens = await issueSessionTokens(user, firmId, req);
  await recordAuditSafe({ action: AuditAction.LOGIN_SUCCEEDED, req, actorId: user.id, firmId, actorRole: firmId ? null : ROLES.SUPER_ADMIN });
  return tokens;
}

/**
 * Refresh-token rotation with reuse detection:
 *  - a valid, unrotated token is exchanged for a new one (same family);
 *  - a rotated token presented again within REUSE_GRACE_MS (another tab refreshed first) gets an access token
 *    for the successor session, without a new cookie;
 *  - otherwise a rotated token means theft: the whole family is revoked.
 * @returns {Promise<{ accessToken: string, refreshToken?: string }>}
 */
async function refresh(rawToken, req) {
  if (!rawToken) throw Unauthorized('Session expired');
  const session = await prisma.userSession.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw Unauthorized('Session expired');

  if (session.rotatedAt) {
    const successor = session.replacedById ? await prisma.userSession.findUnique({ where: { id: session.replacedById } }) : null;
    if (Date.now() - session.rotatedAt.getTime() <= REUSE_GRACE_MS && successor && !successor.revokedAt) {
      return { accessToken: signAccessToken({ userId: session.userId, sessionId: successor.id, firmId: successor.firmId }) };
    }
    await revokeFamily(session.familyId, 'TOKEN_REUSE');
    await invalidateUserPrincipals(session.userId);
    await recordAuditSafe({ action: AuditAction.TOKEN_REUSE_DETECTED, req, actorId: session.userId, firmId: session.firmId, meta: { familyId: session.familyId } });
    throw Unauthorized('Session expired');
  }

  // The user / firm access must still be valid.
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  const contextOk = user && !user.deletedAt && user.status === 'ACTIVE' && (session.firmId ? !!(await resolveFirmAccess(user.id, session.firmId)) : user.isSuperadmin);
  if (!contextOk) {
    await revokeFamily(session.familyId, 'ACCESS_REMOVED');
    throw Unauthorized('Session expired');
  }

  return prisma.$transaction(async (tx) => {
    const { session: next, refreshToken } = await createSession({ userId: session.userId, firmId: session.firmId, familyId: session.familyId, meta: meta(req) }, tx);
    // Conditional update: if a concurrent request rotated first, this one loses and the client retries via the grace path.
    const claimed = await tx.userSession.updateMany({ where: { id: session.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: new Date(), replacedById: next.id, lastUsedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(401, 'Session expired');
    return { refreshToken, accessToken: signAccessToken({ userId: session.userId, sessionId: next.id, firmId: session.firmId }) };
  });
}

async function logout(rawToken, req) {
  if (!rawToken) return;
  const session = await prisma.userSession.findUnique({ where: { tokenHash: sha256(rawToken) } });
  if (!session) return;
  await revokeFamily(session.familyId, 'LOGOUT');
  await invalidateUserPrincipals(session.userId);
  await recordAuditSafe({ action: AuditAction.LOGOUT, req, actorId: session.userId, firmId: session.firmId });
}

/** Switches the active firm (or platform) context: a fresh session family for the new context. */
async function switchContext(rawToken, { firmId }, req) {
  const session = rawToken ? await prisma.userSession.findUnique({ where: { tokenHash: sha256(rawToken) } }) : null;
  if (!session || session.revokedAt || session.rotatedAt || session.expiresAt <= new Date()) throw Unauthorized('Session expired');
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== 'ACTIVE' || user.deletedAt) throw Unauthorized('Session expired');
  const target = firmId === 'platform' ? null : firmId;
  if (target === null ? !user.isSuperadmin : !(await resolveFirmAccess(user.id, target))) throw NotFound('Context not found');
  await revokeFamily(session.familyId, 'CONTEXT_SWITCH');
  await invalidateUserPrincipals(user.id);
  const tokens = await issueSessionTokens(user, target, req);
  await recordAuditSafe({ action: AuditAction.CONTEXT_SWITCHED, req, actorId: user.id, firmId: target, meta: { from: session.firmId } });
  return tokens;
}

/** Current user, active context with roles + permissions, and every context the user can switch to. */
async function me(principal) {
  const user = await prisma.user.findUnique({ where: { id: principal.userId }, select: { id: true, email: true, fullName: true, phone: true, isSuperadmin: true, lastLoginAt: true } });
  const firms = await listFirmAccess(principal.userId);
  const roleRows = await prisma.role.findMany({ where: { code: { in: principal.roles } }, select: { code: true, name: true }, orderBy: { sortOrder: 'asc' } });
  const [employee, client] = await Promise.all([
    principal.employeeId ? prisma.employeeProfile.findUnique({ where: { id: principal.employeeId }, select: { id: true, employeeCode: true, designation: true } }) : null,
    principal.clientId ? prisma.client.findUnique({ where: { id: principal.clientId }, select: { id: true, clientCode: true, name: true } }) : null,
  ]);
  return {
    user,
    context: {
      type: principal.firmId ? 'FIRM' : 'PLATFORM',
      firm: principal.firm,
      roles: roleRows,
      permissions: principal.permissions,
    },
    contexts: [
      ...(user.isSuperadmin ? [{ firmId: 'platform', label: 'Platform administration', roles: [ROLES.SUPER_ADMIN] }] : []),
      ...firms.map((f) => ({ firmId: f.firm.id, label: f.firm.name, firmCode: f.firm.firmCode, roles: f.roles })),
    ],
    employee,
    client,
  };
}

/** Always answers the same way, whether or not the email exists (no account enumeration). */
async function forgotPassword({ email }) {
  // At most one reset email per address per minute.
  const throttleKey = `${env.QUEUE_PREFIX}:pwreset:${hmac(email)}`;
  const first = await redis.set(throttleKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
  if (!first) return {};
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt || user.status !== 'ACTIVE' || !user.passwordHash) return {};
  const dev = await createAndSendPasswordReset(user);
  await recordAuditSafe({ action: AuditAction.PASSWORD_RESET_REQUESTED, actorId: user.id, firmId: null });
  return dev;
}

async function findValidToken(raw, purpose) {
  const token = await prisma.authToken.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
  if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= new Date() || token.user.deletedAt) return null;
  return token;
}

/** For the set-password screens: whether a link is still valid, and whose it is (masked). */
async function tokenInfo({ token, purpose }) {
  const t = await findValidToken(token, purpose);
  if (!t) throw BadRequest(INVALID_LINK);
  const [local, domain] = t.user.email.split('@');
  return { purpose, fullName: t.user.fullName, email: `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}` };
}

/**
 * Consumes an INVITE or PASSWORD_RESET token and sets the password.
 * An invite activates the account; a reset never re-enables a disabled account. All sessions are revoked.
 */
async function completePasswordToken({ token, password }, purpose, req) {
  const t = await findValidToken(token, purpose);
  if (!t) throw BadRequest(INVALID_LINK);
  if (passwordContainsEmail(password, t.user.email)) throw BadRequest('Password must not contain your email name');
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw BadRequest(INVALID_LINK);
    await tx.user.update({
      where: { id: t.userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        ...(purpose === 'INVITE' && t.user.status === 'INVITED' ? { status: 'ACTIVE' } : {}),
      },
    });
    await revokeAllUserSessions(t.userId, 'PASSWORD_SET', {}, tx);
    await recordAudit({ action: purpose === 'INVITE' ? AuditAction.INVITE_ACCEPTED : AuditAction.PASSWORD_RESET_COMPLETED, req, actorId: t.userId, firmId: null }, tx);
  });
  await invalidateUserPrincipals(t.userId);
}

async function changePassword(principal, { currentPassword, newPassword }, req) {
  const user = await prisma.user.findUnique({ where: { id: principal.userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw BadRequest('Current password is incorrect');
  if (currentPassword === newPassword) throw BadRequest('New password must be different from the current password');
  if (passwordContainsEmail(newPassword, user.email)) throw BadRequest('Password must not contain your email name');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() } });
    // Other devices are signed out; this device stays signed in.
    await revokeAllUserSessions(user.id, 'PASSWORD_CHANGED', { exceptFamilyId: principal.familyId }, tx);
    await recordAudit({ action: AuditAction.PASSWORD_CHANGED, principal, req }, tx);
  });
  await invalidateUserPrincipals(user.id);
}

/** Active devices: the head (unrotated) session of each live family. */
async function listSessions(principal) {
  const rows = await prisma.userSession.findMany({
    where: { userId: principal.userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, familyId: true, firmId: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  const firstSeen = await prisma.userSession.groupBy({ by: ['familyId'], where: { familyId: { in: rows.map((r) => r.familyId) } }, _min: { createdAt: true } });
  const signedInAt = new Map(firstSeen.map((f) => [f.familyId, f._min.createdAt]));
  return rows.map((r) => ({
    id: r.id,
    current: r.familyId === principal.familyId,
    userAgent: r.userAgent,
    ip: r.ip,
    firmId: r.firmId,
    signedInAt: signedInAt.get(r.familyId) ?? r.createdAt,
    lastActiveAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));
}

async function revokeSession(principal, sessionId, req) {
  const s = await prisma.userSession.findFirst({ where: { id: sessionId, userId: principal.userId } });
  if (!s) throw NotFound('Session not found');
  await revokeFamily(s.familyId, 'USER_REVOKED');
  await invalidateUserPrincipals(principal.userId);
  await recordAudit({ action: AuditAction.SESSION_REVOKED, principal, req, meta: { current: s.familyId === principal.familyId } });
  return { current: s.familyId === principal.familyId };
}

export { login, refresh, logout, switchContext, me, forgotPassword, tokenInfo, completePasswordToken, changePassword, listSessions, revokeSession };
