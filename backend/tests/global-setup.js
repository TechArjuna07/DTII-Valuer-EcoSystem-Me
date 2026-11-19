import './setup-env.js';
import { migrateTestDatabase } from '../scripts/migrate-test.js';

/**
 * Before integration tests: migrate the *_test database, load reference data (roles, permissions, FYs)
 * and flush the dedicated Redis test DB (rate-limit counters, caches).
 */
export default async function globalSetup() {
  migrateTestDatabase();
  const { PrismaClient } = await import('@prisma/client');
  const { seedReferenceData } = await import('../prisma/seed/index.js');
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  await seedReferenceData(prisma);
  await prisma.$disconnect();

  const { default: Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}
