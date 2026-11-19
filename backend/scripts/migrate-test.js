/**
 * Applies all migrations to the TEST database (TEST_DATABASE_MIGRATION_URL), so integration tests
 * always run against the current schema. Used by `pnpm db:migrate:test` and the Jest global setup.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function migrateTestDatabase() {
  const { TEST_DATABASE_URL, TEST_DATABASE_MIGRATION_URL } = process.env;
  if (!TEST_DATABASE_URL || !TEST_DATABASE_MIGRATION_URL) {
    throw new Error('TEST_DATABASE_URL and TEST_DATABASE_MIGRATION_URL must be set in backend/.env');
  }
  if (!/_test\b/.test(new URL(TEST_DATABASE_MIGRATION_URL).pathname)) {
    throw new Error('Refusing to migrate: the test database name must end with _test');
  }
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const prismaBin = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaBin, 'migrate', 'deploy'], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DATABASE_MIGRATION_URL: TEST_DATABASE_MIGRATION_URL },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrateTestDatabase();
  console.log('Test database migrated.');
}
