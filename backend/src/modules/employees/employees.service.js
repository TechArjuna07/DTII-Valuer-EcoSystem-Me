import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, Conflict, NotFound } from '../../utils/errors.js';
import { nextFirmCode } from '../../database/sequences.js';
import { AuditAction, recordAudit } from '../../services/audit.service.js';
import { invalidateUserPrincipals } from '../../services/principal.service.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { ensureUserForFirm, userSummary } from '../users/users.service.js';
import { resendInvite, sendInvite } from '../auth/invitations.js';
import { STAFF_ROLE_CODES } from './employees.schema.js';

/**
 * Employee master. Every query is scoped to principal.firmId; employees of other firms are reported as 404.
 * Safeguards: an admin cannot deactivate themselves or remove their own admin role, and a firm always keeps at
 * least one active Firm Admin.
 */

async function roleMap(db = prisma) {
  const rows = await db.role.findMany({ where: { code: { in: STAFF_ROLE_CODES } }, select: { id: true, code: true, name: true } });
  return new Map(rows.map((r) => [r.code, r]));
}

async function toEmployee(e) {
  const roles = await prisma.userRole.findMany({
    where: { firmId: e.firmId, userId: e.userId, status: 'ACTIVE', role: { code: { in: STAFF_ROLE_CODES } } },
    select: { role: { select: { code: true, name: true, sortOrder: true } } },
  });
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    designation: e.designation,
    department: e.department,
    registrationNo: e.registrationNo,
    dateOfJoining: e.dateOfJoining,
    status: e.status,
    createdAt: e.createdAt,
    user: userSummary(e.user),
    roles: roles.sort((a, b) => a.role.sortOrder - b.role.sortOrder).map((r) => ({ code: r.role.code, name: r.role.name })),
  };
}

async function findInFirm(firmId, id, db = prisma) {
  const e = await db.employeeProfile.findFirst({ where: { id, firmId, deletedAt: null }, include: { user: true } });
  if (!e) throw NotFound('Employee not found');
  return e;
}

/** Active Firm Admins other than `exceptUserId`. */
const otherActiveAdmins = (firmId, exceptUserId, db = prisma) =>
  db.userRole.count({
    where: {
      firmId,
      status: 'ACTIVE',
      role: { code: ROLES.FIRM_ADMIN },
      userId: { not: exceptUserId },
      user: { status: { in: ['ACTIVE', 'INVITED'] }, deletedAt: null },
    },
  });

async function list(principal, { page, pageSize, search, role, status }) {
  const where = {
    firmId: principal.firmId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(role ? { user: { roles: { some: { firmId: principal.firmId, status: 'ACTIVE', role: { code: role } } } } } : {}),
    ...(search
      ? {
          OR: [
            { employeeCode: { contains: search, mode: 'insensitive' } },
            { designation: { contains: search, mode: 'insensitive' } },
            { user: { fullName: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.employeeProfile.findMany({ where, include: { user: true }, orderBy: { employeeCode: 'asc' }, ...skipTake({ page, pageSize }) }),
    prisma.employeeProfile.count({ where }),
  ]);
  return paginate(await Promise.all(rows.map(toEmployee)), total, { page, pageSize });
}

async function get(principal, id) {
  return toEmployee(await findInFirm(principal.firmId, id));
}

async function create(principal, body, req) {
  const { fullName, email, phone, roles, ...profile } = body;
  const result = await prisma.$transaction(async (tx) => {
    const { user, inviteToken } = await ensureUserForFirm(tx, { email, fullName, phone, createdById: principal.userId });
    const existing = await tx.employeeProfile.findUnique({ where: { firmId_userId: { firmId: principal.firmId, userId: user.id } } });
    if (existing) throw Conflict(`This person is already registered as ${existing.employeeCode}`);
    const map = await roleMap(tx);
    for (const code of roles) {
      await tx.userRole.upsert({
        where: { userId_firmId_roleId: { userId: user.id, firmId: principal.firmId, roleId: map.get(code).id } },
        update: { status: 'ACTIVE' },
        create: { userId: user.id, firmId: principal.firmId, roleId: map.get(code).id, createdById: principal.userId },
      });
    }
    const employeeCode = await nextFirmCode(tx, principal.firmId, 'EMPLOYEE');
    const employee = await tx.employeeProfile.create({ data: { firmId: principal.firmId, userId: user.id, employeeCode, ...profile, createdById: principal.userId } });
    await recordAudit({ action: AuditAction.EMPLOYEE_REGISTERED, principal, req, entityType: 'employee', entityId: employee.id, meta: { employeeCode, roles } }, tx);
    return { employee, user, inviteToken, roleNames: roles.map((r) => map.get(r).name) };
  });
  await invalidateUserPrincipals(result.user.id);
  const invite = result.inviteToken
    ? await sendInvite({ rawToken: result.inviteToken, email: result.user.email, fullName: result.user.fullName, firmName: principal.firm.name, roleNames: result.roleNames })
    : { sent: false, existingAccount: true };
  return { employee: await get(principal, result.employee.id), invite };
}

async function update(principal, id, body, req) {
  const { fullName, phone, roles, ...profile } = body;
  const e = await findInFirm(principal.firmId, id);
  await prisma.$transaction(async (tx) => {
    if (fullName !== undefined || phone !== undefined) {
      await tx.user.update({ where: { id: e.userId }, data: { ...(fullName !== undefined ? { fullName } : {}), ...(phone !== undefined ? { phone } : {}) } });
    }
    if (Object.keys(profile).length) await tx.employeeProfile.update({ where: { id }, data: profile });

    if (roles) {
      const map = await roleMap(tx);
      const current = (
        await tx.userRole.findMany({ where: { firmId: principal.firmId, userId: e.userId, status: 'ACTIVE', role: { code: { in: STAFF_ROLE_CODES } } }, select: { role: { select: { code: true } } } })
      ).map((r) => r.role.code);
      const removed = current.filter((r) => !roles.includes(r));
      const added = roles.filter((r) => !current.includes(r));
      if (removed.includes(ROLES.FIRM_ADMIN)) {
        if (e.userId === principal.userId) throw BadRequest('You cannot remove your own Firm Admin role');
        if ((await otherActiveAdmins(principal.firmId, e.userId, tx)) === 0) throw BadRequest('The firm must keep at least one active Firm Admin');
      }
      for (const code of removed) {
        await tx.userRole.update({ where: { userId_firmId_roleId: { userId: e.userId, firmId: principal.firmId, roleId: map.get(code).id } }, data: { status: 'INACTIVE' } });
      }
      for (const code of added) {
        await tx.userRole.upsert({
          where: { userId_firmId_roleId: { userId: e.userId, firmId: principal.firmId, roleId: map.get(code).id } },
          update: { status: 'ACTIVE' },
          create: { userId: e.userId, firmId: principal.firmId, roleId: map.get(code).id, createdById: principal.userId },
        });
      }
      if (removed.length || added.length) {
        await recordAudit({ action: AuditAction.EMPLOYEE_ROLES_CHANGED, principal, req, entityType: 'employee', entityId: id, meta: { added, removed } }, tx);
      }
    }
    const fields = Object.keys(body).filter((k) => k !== 'roles');
    if (fields.length) await recordAudit({ action: AuditAction.EMPLOYEE_UPDATED, principal, req, entityType: 'employee', entityId: id, meta: { fields } }, tx);
  });
  await invalidateUserPrincipals(e.userId);
  return get(principal, id);
}

/** Deactivation removes firm access immediately (sessions in this firm are revoked). History is kept. */
async function deactivate(principal, id, req) {
  const e = await findInFirm(principal.firmId, id);
  if (e.userId === principal.userId) throw BadRequest('You cannot deactivate your own account');
  if (e.status === 'INACTIVE') throw BadRequest('Employee is already inactive');
  const isAdmin = await prisma.userRole.count({ where: { firmId: principal.firmId, userId: e.userId, status: 'ACTIVE', role: { code: ROLES.FIRM_ADMIN } } });
  if (isAdmin && (await otherActiveAdmins(principal.firmId, e.userId)) === 0) throw BadRequest('The firm must keep at least one active Firm Admin');
  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({ where: { id }, data: { status: 'INACTIVE' } });
    await tx.userSession.updateMany({ where: { userId: e.userId, firmId: principal.firmId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'EMPLOYEE_DEACTIVATED' } });
    await recordAudit({ action: AuditAction.EMPLOYEE_DEACTIVATED, principal, req, entityType: 'employee', entityId: id }, tx);
  });
  await invalidateUserPrincipals(e.userId);
  return get(principal, id);
}

async function reactivate(principal, id, req) {
  const e = await findInFirm(principal.firmId, id);
  if (e.status === 'ACTIVE') throw BadRequest('Employee is already active');
  await prisma.$transaction(async (tx) => {
    await tx.employeeProfile.update({ where: { id }, data: { status: 'ACTIVE' } });
    await recordAudit({ action: AuditAction.EMPLOYEE_REACTIVATED, principal, req, entityType: 'employee', entityId: id }, tx);
  });
  await invalidateUserPrincipals(e.userId);
  return get(principal, id);
}

/** Clears a login lockout (after too many wrong passwords). */
async function unlock(principal, id, req) {
  const e = await findInFirm(principal.firmId, id);
  await prisma.user.update({ where: { id: e.userId }, data: { lockedUntil: null, failedLoginCount: 0 } });
  await recordAudit({ action: AuditAction.ACCOUNT_UNLOCKED, principal, req, entityType: 'employee', entityId: id });
  return get(principal, id);
}

async function resendEmployeeInvite(principal, id, req) {
  const e = await findInFirm(principal.firmId, id);
  if (e.user.status !== 'INVITED') throw BadRequest('This employee has already activated their account');
  const view = await toEmployee(e);
  const invite = await resendInvite({ user: e.user, firmName: principal.firm.name, roleNames: view.roles.map((r) => r.name), createdById: principal.userId });
  await recordAudit({ action: AuditAction.INVITE_SENT, principal, req, entityType: 'employee', entityId: id });
  return invite;
}

export { list, get, create, update, deactivate, reactivate, unlock, resendEmployeeInvite };
