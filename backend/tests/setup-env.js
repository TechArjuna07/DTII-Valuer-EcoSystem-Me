/**
 * Points every test at the TEST database and a separate Redis DB index BEFORE any app module loads,
 * so tests can never touch development data.
 */
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

process.env.NODE_ENV = 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (process.env.TEST_DATABASE_MIGRATION_URL) process.env.DATABASE_MIGRATION_URL = process.env.TEST_DATABASE_MIGRATION_URL;
if (process.env.REDIS_URL) {
  const u = new URL(process.env.REDIS_URL);
  u.pathname = `/${process.env.REDIS_TEST_DB || '1'}`;
  process.env.REDIS_URL = u.toString();
}
process.env.QUEUE_PREFIX = 'valuers-test';
process.env.COOKIE_SECURE = 'false';
process.env.STORAGE_LOCAL_ROOT = './.test-storage';
process.env.MAIL_PROVIDER = 'log';
// Tests log in many times from one IP; rate limiting itself is covered by a dedicated test.
process.env.AUTH_THROTTLE_LIMIT_PER_MINUTE = '10000';
process.env.REFRESH_THROTTLE_LIMIT_PER_MINUTE = '10000';
process.env.THROTTLE_LIMIT_PER_MINUTE = '100000';
