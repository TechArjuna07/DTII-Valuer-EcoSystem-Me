import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Single Prisma client for the process. Connects as the least-privileged runtime role (valuers_app):
 * it cannot alter the schema and cannot UPDATE/DELETE append-only audit tables.
 */
const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  // Tests assert on rejected queries (append-only, constraints); don't print them as errors.
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : env.NODE_ENV === 'test' ? [] : ['error'],
});

/** Prisma unique-constraint violation (P2002). */
const isUniqueViolation = (e) => e?.code === 'P2002';

export { prisma, isUniqueViolation };
