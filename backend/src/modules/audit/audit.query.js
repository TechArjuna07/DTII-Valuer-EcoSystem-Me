import { z } from 'zod';
import { prisma } from '../../database/prisma.js';
import { listQuery, paginate, skipTake } from '../../utils/pagination.js';

const auditListQuery = z.strictObject({
  page: listQuery.page,
  pageSize: listQuery.pageSize,
  action: z.string().trim().max(80).regex(/^[A-Z_]+$/).optional(),
  actorId: z.uuid().optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.uuid().optional(),
  firmId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/**
 * Read-only audit query. `firmId` scoping is decided by the caller from the principal:
 *  - firm admin: always their own firm (the query's firmId is ignored)
 *  - superadmin: any firm, or all
 */
async function queryAudit({ scopeFirmId, page, pageSize, action, actorId, entityType, entityId, firmId, from, to }) {
  const where = {
    ...(scopeFirmId !== undefined ? { firmId: scopeFirmId } : firmId ? { firmId } : {}),
    ...(action ? { action } : {}),
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...skipTake({ page, pageSize }) }),
    prisma.auditLog.count({ where }),
  ]);
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const actors = actorIds.length ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } }) : [];
  const byId = new Map(actors.map((a) => [a.id, a]));
  const items = rows.map((r) => ({ ...r, actor: r.actorId ? byId.get(r.actorId) ?? null : null }));
  return paginate(items, total, { page, pageSize });
}

export { auditListQuery, queryAudit };
