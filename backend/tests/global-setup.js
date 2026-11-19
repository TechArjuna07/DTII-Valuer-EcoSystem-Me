import { migrateTestDatabase } from '../scripts/migrate-test.js';

/** Brings the *_test database up to the current schema before integration tests run. */
export default async function globalSetup() {
  migrateTestDatabase();
}
