import { z } from 'zod';

/** Common list query fields: page (1-based), pageSize (≤ 100), free-text search. */
const listQuery = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
};

const skipTake = ({ page, pageSize }) => ({ skip: (page - 1) * pageSize, take: pageSize });

const paginate = (items, total, { page, pageSize }) => ({ items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

export { listQuery, skipTake, paginate };
