/**
 * DEVELOPMENT ONLY — wipes all business data (firms, users, clients, cases, documents, audit history) from the
 * database in DATABASE_MIGRATION_URL, deletes the local document files, flushes the Redis DB, restarts firm
 * numbering (the next firm is FIRM001) and re-seeds the reference data (roles, permissions, financial years,
 * categories, document types).
 *
 *   node scripts/reset-dev-data.js --confirm
 *
 * Refuses to run when NODE_ENV=production or when the database name looks like production.
 * Append-only protections are triggers owned by the schema owner; they are disabled only for the duration of the
 * TRUNCATE and re-enabled in the same transaction.
 */
import 'dotenv/config';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { seedReferenceData } from '../prisma/seed/index.js';

async function main() {
  if (!process.argv.includes('--confirm')) throw new Error('This deletes ALL data. Re-run with --confirm.');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production environment');
  const url = process.env.DATABASE_MIGRATION_URL;
  const dbName = new URL(url).pathname.slice(1);
  if (/prod/i.test(dbName)) throw new Error(`Refusing to reset database "${dbName}"`);

  const owner = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = (await owner.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`).map((r) => r.tablename);
    const list = tables.map((t) => `"${t}"`).join(', ');
    await owner.$transaction([
      ...tables.map((t) => owner.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER USER`)),
      owner.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`),
      ...tables.map((t) => owner.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER USER`)),
      owner.$executeRawUnsafe('ALTER SEQUENCE "organization_code_seq" RESTART WITH 1'),
    ]);
    console.log(`Database "${dbName}": ${tables.length} tables emptied, firm numbering restarted.`);
  } finally {
    await owner.$disconnect();
  }

  const root = path.resolve(process.env.STORAGE_LOCAL_ROOT || './storage');
  await rm(path.join(root, 'firms'), { recursive: true, force: true });
  console.log(`Local document files removed from ${path.join(root, 'firms')}.`);

  const redis = new Redis(process.env.REDIS_URL);
  await redis.flushdb();
  await redis.quit();
  console.log('Redis (queues, caches, rate-limit counters) flushed.');

  const app = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    console.log('Reference data re-seeded:', await seedReferenceData(app));
  } finally {
    await app.$disconnect();
  }
}

main().catch((e) => {
  console.error('Reset failed:', e.message);
  process.exit(1);
});
