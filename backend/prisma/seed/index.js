/**
 * Idempotent reference-data seed: roles, permissions, platform-default role permissions, financial years.
 * Safe to run repeatedly (upserts). Runs with the runtime role (DATABASE_URL); no schema changes.
 *
 *   pnpm --filter @valuers/backend db:seed
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ROLE_DEFINITIONS, PERMISSION_DEFINITIONS } from '../../src/config/rbac.js';
import { fyFromStartYear, fyStartYear } from '../../src/utils/financial-year.js';
import { seedMasters } from './masters.js';

/** First FY offered in masters; the seed also creates the next FY so April roll-over needs no manual step. */
const FIRST_FY_START = 2024;

async function seedRbac(prisma) {
  const roleIds = {};
  for (const r of ROLE_DEFINITIONS) {
    const row = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, scope: r.scope, sortOrder: r.sortOrder, isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, scope: r.scope, sortOrder: r.sortOrder, isSystem: true },
    });
    roleIds[r.code] = row.id;
  }

  let links = 0;
  for (const p of PERMISSION_DEFINITIONS) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description, isCritical: p.isCritical },
      create: { code: p.code, module: p.module, description: p.description, isCritical: p.isCritical },
    });
    const wanted = p.roles.map((code) => roleIds[code]);
    // Platform defaults follow the catalogue exactly: add missing links, remove stale ones.
    await prisma.rolePermission.deleteMany({ where: { permissionId: perm.id, roleId: { notIn: wanted } } });
    for (const roleId of wanted) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: perm.id } },
        update: {},
        create: { roleId, permissionId: perm.id },
      });
      links += 1;
    }
  }
  return { roles: ROLE_DEFINITIONS.length, permissions: PERMISSION_DEFINITIONS.length, links };
}

async function seedFinancialYears(prisma, today = new Date()) {
  const last = fyStartYear(today) + 1;
  let count = 0;
  for (let y = FIRST_FY_START; y <= last; y += 1) {
    const fy = fyFromStartYear(y);
    await prisma.financialYear.upsert({
      where: { code: fy.code },
      update: { label: fy.label, shortCode: fy.shortCode, startDate: fy.startDate, endDate: fy.endDate },
      create: fy,
    });
    count += 1;
  }
  return { financialYears: count };
}

async function seedReferenceData(prisma) {
  return { ...(await seedRbac(prisma)), ...(await seedFinancialYears(prisma)), ...(await seedMasters(prisma)) };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await seedReferenceData(prisma);
    console.log('Seed complete:', result);
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  main().catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
}

export { seedReferenceData, seedRbac, seedFinancialYears };
