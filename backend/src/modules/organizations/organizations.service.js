import { prisma } from '../../database/prisma.js';
import { ROLES } from '../../config/rbac.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { nextFirmCode, nextFirmCodeForOrganization } from '../../database/sequences.js';
import { AuditAction, recordAudit } from '../../services/audit.service.js';
import { invalidateFirmPrincipals } from '../../services/principal.service.js';
import { paginate, skipTake } from '../../utils/pagination.js';
import { ensureUserForFirm, userSummary } from '../users/users.service.js';
import { resendInvite, sendInvite } from '../auth/invitations.js';

/**
 * Platform (Superadmin) management of valuation firms. Superadmin sees firm metadata and aggregates only —
 * never cases or documents.
 */

const firmSelect = {
  id: true,
  firmCode: true,
  name: true,
  legalName: true,
  registrationNo: true,
  gstin: true,
  email: true,
  phone: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  pincode: true,
  status: true,
  subscriptionPlan: true,
  subscriptionStatus: true,
  subscriptionValidTill: true,
  maxUsers: true,
  createdAt: true,
  updatedAt: true,
};

async function firmAdmins(firmId) {
  const rows = await prisma.userRole.findMany({
    where: { firmId, role: { code: ROLES.FIRM_ADMIN } },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({ ...userSummary(r.user), roleStatus: r.status }));
}

async function firmCounts(firmId) {
  const [employees, clients] = await Promise.all([
    prisma.employeeProfile.count({ where: { firmId, deletedAt: null, status: 'ACTIVE' } }),
    prisma.client.count({ where: { firmId, deletedAt: null, status: 'ACTIVE' } }),
  ]);
  return { employees, clients };
}

/**
 * Registers a firm and its first Firm Admin in ONE transaction: firm code, organization, settings,
 * admin login (new or existing), FIRM_ADMIN role, employee profile, invite token, audit. The invite email
 * is sent after commit so a mail outage cannot leave a half-created firm.
 */
async function registerFirm(principal, body, req) {
  const { admin, ...firmData } = body;
  const result = await prisma.$transaction(async (tx) => {
    const firmCode = await nextFirmCodeForOrganization(tx);
    const firm = await tx.organization.create({ data: { ...firmData, firmCode, createdById: principal.userId }, select: firmSelect });
    await tx.organizationSettings.create({ data: { firmId: firm.id } });

    const { user, inviteToken } = await ensureUserForFirm(tx, { email: admin.email, fullName: admin.fullName, phone: admin.phone, createdById: principal.userId });
    const role = await tx.role.findUniqueOrThrow({ where: { code: ROLES.FIRM_ADMIN } });
    await tx.userRole.create({ data: { userId: user.id, firmId: firm.id, roleId: role.id, createdById: principal.userId } });
    const employeeCode = await nextFirmCode(tx, firm.id, 'EMPLOYEE');
    const employee = await tx.employeeProfile.create({
      data: { firmId: firm.id, userId: user.id, employeeCode, designation: admin.designation ?? 'Firm Administrator', createdById: principal.userId },
    });

    await recordAudit({ action: AuditAction.FIRM_REGISTERED, principal, req, firmId: firm.id, entityType: 'organization', entityId: firm.id, meta: { firmCode, name: firm.name } }, tx);
    await recordAudit(
      { action: AuditAction.EMPLOYEE_REGISTERED, principal, req, firmId: firm.id, entityType: 'employee', entityId: employee.id, meta: { employeeCode, roles: [ROLES.FIRM_ADMIN] } },
      tx,
    );
    return { firm, user, inviteToken };
  });

  const invite = result.inviteToken
    ? await sendInvite({ rawToken: result.inviteToken, email: result.user.email, fullName: result.user.fullName, firmName: result.firm.name, roleNames: ['Firm Admin'] })
    : { sent: false, existingAccount: true };
  return { firm: result.firm, admin: userSummary(result.user), invite };
}

async function listFirms({ page, pageSize, search, status }) {
  const where = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(search
      ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { firmCode: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { city: { contains: search, mode: 'insensitive' } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      select: { ...firmSelect, _count: { select: { employees: { where: { deletedAt: null, status: 'ACTIVE' } }, clients: { where: { deletedAt: null, status: 'ACTIVE' } } } } },
      orderBy: { createdAt: 'desc' },
      ...skipTake({ page, pageSize }),
    }),
    prisma.organization.count({ where }),
  ]);
  const items = rows.map(({ _count, ...f }) => ({ ...f, counts: { employees: _count.employees, clients: _count.clients } }));
  return paginate(items, total, { page, pageSize });
}

async function getFirm(id) {
  const firm = await prisma.organization.findFirst({ where: { id, deletedAt: null }, select: firmSelect });
  if (!firm) throw NotFound('Firm not found');
  const [admins, counts] = await Promise.all([firmAdmins(id), firmCounts(id)]);
  return { ...firm, admins, counts };
}

async function updateFirm(principal, id, body, req) {
  await getFirm(id);
  const firm = await prisma.$transaction(async (tx) => {
    const updated = await tx.organization.update({ where: { id }, data: body, select: firmSelect });
    await recordAudit({ action: AuditAction.FIRM_UPDATED, principal, req, firmId: id, entityType: 'organization', entityId: id, meta: { fields: Object.keys(body) } }, tx);
    return updated;
  });
  return firm;
}

/** Suspending or deactivating a firm signs out all of its users immediately. */
async function setFirmStatus(principal, id, { status, reason }, req) {
  const current = await getFirm(id);
  if (current.status === status) throw BadRequest(`Firm is already ${status.toLowerCase()}`);
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id }, data: { status } });
    if (status !== 'ACTIVE') {
      await tx.userSession.updateMany({ where: { firmId: id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: `FIRM_${status}` } });
    }
    await recordAudit({ action: AuditAction.FIRM_STATUS_CHANGED, principal, req, firmId: id, entityType: 'organization', entityId: id, meta: { from: current.status, to: status, reason } }, tx);
  });
  await invalidateFirmPrincipals(id);
  return getFirm(id);
}

async function resendAdminInvite(principal, firmId, userId, req) {
  const firm = await getFirm(firmId);
  const admin = firm.admins.find((a) => a.id === userId);
  if (!admin) throw NotFound('Administrator not found');
  if (admin.status !== 'INVITED') throw BadRequest('This administrator has already activated their account');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const invite = await resendInvite({ user, firmName: firm.name, roleNames: ['Firm Admin'], createdById: principal.userId });
  await recordAudit({ action: AuditAction.INVITE_SENT, principal, req, firmId, entityType: 'user', entityId: userId });
  return invite;
}

/** Platform dashboard: totals only. Case statistics are added with the cases module. */
async function platformSummary() {
  const [firmsByStatus, employees, clients, users, recentFirms] = await Promise.all([
    prisma.organization.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
    prisma.employeeProfile.count({ where: { deletedAt: null, status: 'ACTIVE', organization: { status: 'ACTIVE' } } }),
    prisma.client.count({ where: { deletedAt: null, status: 'ACTIVE', organization: { status: 'ACTIVE' } } }),
    prisma.user.count({ where: { deletedAt: null, isSuperadmin: false, status: 'ACTIVE' } }),
    prisma.organization.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, firmCode: true, name: true, status: true, city: true, createdAt: true } }),
  ]);
  const byStatus = Object.fromEntries(firmsByStatus.map((r) => [r.status, r._count]));
  return {
    firms: { total: firmsByStatus.reduce((n, r) => n + r._count, 0), active: byStatus.ACTIVE ?? 0, suspended: byStatus.SUSPENDED ?? 0, deactivated: byStatus.DEACTIVATED ?? 0 },
    employees,
    clients,
    activeUsers: users,
    recentFirms,
  };
}

export { registerFirm, listFirms, getFirm, updateFirm, setFirmStatus, resendAdminInvite, platformSummary, firmSelect };
