import { env } from '../config/env.js';
import { prisma } from '../database/prisma.js';
import { redis } from '../database/redis.js';
import { logger } from '../config/logger.js';

/**
 * Effective permissions of a set of roles inside a firm:
 *   per role: platform defaults (role_permissions) ± firm overrides (firm_role_permissions, non-critical only)
 *   then the union across the user's roles.
 * Results are cached in Redis under a per-firm version key; any RBAC change bumps the version (instant invalidation).
 */
const CACHE_TTL_SECONDS = 300;
const versionKey = (firmId) => `${env.QUEUE_PREFIX}:perms:ver:${firmId ?? 'platform'}`;

async function computePermissions(firmId, roleCodes) {
  if (!roleCodes.length) return [];
  const roles = await prisma.role.findMany({
    where: { code: { in: roleCodes } },
    select: {
      id: true,
      permissions: { select: { permission: { select: { id: true, code: true, isCritical: true } } } },
    },
  });
  const overrides = firmId
    ? await prisma.firmRolePermission.findMany({
        where: { firmId, roleId: { in: roles.map((r) => r.id) } },
        select: { roleId: true, granted: true, permission: { select: { code: true, isCritical: true } } },
      })
    : [];

  const result = new Set();
  for (const role of roles) {
    const perms = new Set(role.permissions.map((rp) => rp.permission.code));
    for (const o of overrides.filter((x) => x.roleId === role.id && !x.permission.isCritical)) {
      if (o.granted) perms.add(o.permission.code);
      else perms.delete(o.permission.code);
    }
    perms.forEach((p) => result.add(p));
  }
  return [...result].sort();
}

/** @returns {Promise<string[]>} sorted permission codes */
async function effectivePermissions(firmId, roleCodes) {
  const roles = [...new Set(roleCodes)].sort();
  try {
    const ver = (await redis.get(versionKey(firmId))) || '0';
    const key = `${env.QUEUE_PREFIX}:perms:${firmId ?? 'platform'}:${ver}:${roles.join(',')}`;
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    const perms = await computePermissions(firmId, roles);
    await redis.set(key, JSON.stringify(perms), 'EX', CACHE_TTL_SECONDS);
    return perms;
  } catch (e) {
    // Redis unavailable: fall back to the database (correct, just slower).
    logger.warn({ err: e.message }, 'Permission cache unavailable');
    return computePermissions(firmId, roles);
  }
}

async function invalidateFirmPermissions(firmId) {
  await redis.incr(versionKey(firmId)).catch(() => undefined);
}

export { effectivePermissions, invalidateFirmPermissions, computePermissions };
