import { prisma } from '../../database/prisma.js';

import { AuditAction, recordAudit } from '../../services/audit.service.js';
import { firmSelect } from '../organizations/organizations.service.js';
import { STAFF_ROLE_CODES } from '../employees/employees.schema.js';

/** The caller's own firm (Firm Admin). Firm code, status and subscription are Superadmin-only fields. */

const getProfile = (principal) => prisma.organization.findUniqueOrThrow({ where: { id: principal.firmId }, select: firmSelect });

async function updateProfile(principal, body, req) {
  return prisma.$transaction(async (tx) => {
    const firm = await tx.organization.update({ where: { id: principal.firmId }, data: body, select: firmSelect });
    await recordAudit({ action: AuditAction.FIRM_PROFILE_UPDATED, principal, req, entityType: 'organization', entityId: principal.firmId, meta: { fields: Object.keys(body) } }, tx);
    return firm;
  });
}

/** Firm Admin dashboard figures available so far (case pipeline figures arrive with the cases module). */
async function summary(principal) {
  const firmId = principal.firmId;
  const [roleCounts, employeesActive, employeesInactive, pendingInvites, clientsActive, clientsInactive, portalClients, recentClients] = await Promise.all([
    prisma.userRole.groupBy({
      by: ['roleId'],
      where: { firmId, status: 'ACTIVE', role: { code: { in: STAFF_ROLE_CODES } }, user: { employee: { some: { firmId, status: 'ACTIVE', deletedAt: null } } } },
      _count: true,
    }),
    prisma.employeeProfile.count({ where: { firmId, status: 'ACTIVE', deletedAt: null } }),
    prisma.employeeProfile.count({ where: { firmId, status: 'INACTIVE', deletedAt: null } }),
    prisma.employeeProfile.count({ where: { firmId, status: 'ACTIVE', deletedAt: null, user: { status: 'INVITED' } } }),
    prisma.client.count({ where: { firmId, status: 'ACTIVE', deletedAt: null } }),
    prisma.client.count({ where: { firmId, status: 'INACTIVE', deletedAt: null } }),
    prisma.client.count({ where: { firmId, deletedAt: null, userId: { not: null } } }),
    prisma.client.findMany({ where: { firmId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, clientCode: true, name: true, clientType: true, city: true, createdAt: true } }),
  ]);
  const roles = await prisma.role.findMany({ where: { code: { in: STAFF_ROLE_CODES } }, orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true } });
  const countByRole = new Map(roleCounts.map((r) => [r.roleId, r._count]));
  return {
    employees: { active: employeesActive, inactive: employeesInactive, pendingInvites },
    employeesByRole: roles.map((r) => ({ code: r.code, name: r.name, count: countByRole.get(r.id) ?? 0 })),
    clients: { active: clientsActive, inactive: clientsInactive, withPortalLogin: portalClients },
    recentClients,
  };
}

export { getProfile, updateProfile, summary };
