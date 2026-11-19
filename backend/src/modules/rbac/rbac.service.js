import { prisma } from '../../database/prisma.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { AuditAction, recordAudit } from '../../services/audit.service.js';
import { invalidateFirmPermissions } from '../../services/permissions.service.js';
import { invalidateFirmPrincipals } from '../../services/principal.service.js';

/**
 * Firm-level permission matrix. Firm Admins may grant or revoke NON-critical permissions per role.
 * Critical permissions (workflow integrity, approvals, signatures, administration) are fixed by the platform.
 * Platform permissions are never shown to firms.
 */

async function matrix(principal) {
  const [roles, permissions, overrides] = await Promise.all([
    prisma.role.findMany({ where: { scope: 'FIRM' }, orderBy: { sortOrder: 'asc' }, include: { permissions: { select: { permissionId: true } } } }),
    prisma.permission.findMany({ where: { NOT: { module: 'platform' } }, orderBy: [{ module: 'asc' }, { code: 'asc' }] }),
    prisma.firmRolePermission.findMany({ where: { firmId: principal.firmId } }),
  ]);
  const overrideOf = new Map(overrides.map((o) => [`${o.roleId}:${o.permissionId}`, o.granted]));
  return {
    roles: roles.map((r) => ({ code: r.code, name: r.name, description: r.description })),
    permissions: permissions.map((p) => ({
      code: p.code,
      module: p.module,
      description: p.description,
      isCritical: p.isCritical,
      grants: Object.fromEntries(
        roles.map((r) => {
          const byDefault = r.permissions.some((rp) => rp.permissionId === p.id);
          const override = p.isCritical ? undefined : overrideOf.get(`${r.id}:${p.id}`);
          return [r.code, { granted: override ?? byDefault, default: byDefault, overridden: override !== undefined && override !== byDefault }];
        }),
      ),
    })),
  };
}

async function setPermission(principal, { roleCode, permissionCode, granted }, req) {
  const [role, permission] = await Promise.all([
    prisma.role.findFirst({ where: { code: roleCode, scope: 'FIRM' }, include: { permissions: true } }),
    prisma.permission.findUnique({ where: { code: permissionCode } }),
  ]);
  if (!role || !permission || permission.module === 'platform') throw NotFound('Role or permission not found');
  if (permission.isCritical) throw BadRequest('This permission is fixed by the platform and cannot be changed');

  const byDefault = role.permissions.some((rp) => rp.permissionId === permission.id);
  const key = { firmId_roleId_permissionId: { firmId: principal.firmId, roleId: role.id, permissionId: permission.id } };
  await prisma.$transaction(async (tx) => {
    // Matching the platform default removes the override, so future default changes still apply.
    if (granted === byDefault) await tx.firmRolePermission.deleteMany({ where: { firmId: principal.firmId, roleId: role.id, permissionId: permission.id } });
    else
      await tx.firmRolePermission.upsert({
        where: key,
        update: { granted, updatedById: principal.userId },
        create: { firmId: principal.firmId, roleId: role.id, permissionId: permission.id, granted, updatedById: principal.userId },
      });
    await recordAudit({ action: AuditAction.PERMISSIONS_CHANGED, principal, req, entityType: 'role', entityId: role.id, meta: { role: roleCode, permission: permissionCode, granted } }, tx);
  });
  await invalidateFirmPermissions(principal.firmId);
  await invalidateFirmPrincipals(principal.firmId);
  return matrix(principal);
}

export { matrix, setPermission };
