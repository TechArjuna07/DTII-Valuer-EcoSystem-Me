import { loadEnv } from '../../src/config/env.js';

const valid = {
  NODE_ENV: 'development',
  WEB_APP_URL: 'http://localhost:3100',
  CORS_ORIGINS: 'http://localhost:3100',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://:p@127.0.0.1:6391/0',
  JWT_ACCESS_SECRET: 'x'.repeat(64),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  HMAC_KEY: 'h'.repeat(32),
};

describe('environment validation', () => {
  test('accepts a valid development configuration with safe defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4100);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3100']);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(Object.isFrozen(env)).toBe(true);
  });

  test('rejects a short JWT secret and a wrong-size encryption key', () => {
    expect(() => loadEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadEnv({ ...valid, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/DATA_ENCRYPTION_KEY/);
  });

  test('error messages never echo secret values', () => {
    const secret = 'super-secret-value';
    try {
      loadEnv({ ...valid, JWT_ACCESS_SECRET: secret });
      throw new Error('should have failed');
    } catch (e) {
      expect(e.message).not.toContain(secret);
    }
  });

  test('production hardening: secure cookies, malware scanning, S3, no wildcard CORS', () => {
    const prod = { ...valid, NODE_ENV: 'production', MAIL_PROVIDER: 'gmail', GMAIL_SMTP_USER: 'u@example.com', GMAIL_SMTP_APP_PASSWORD: 'app-pass' };
    expect(() => loadEnv(prod)).toThrow(/SCANNER/);
    expect(() => loadEnv({ ...prod, SCANNER: 'clamav', COOKIE_SECURE: 'false', STORAGE_DRIVER: 's3', S3_BUCKET: 'b' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ ...prod, SCANNER: 'clamav', STORAGE_DRIVER: 'local' })).toThrow(/STORAGE_DRIVER/);
    expect(() => loadEnv({ ...prod, SCANNER: 'clamav', STORAGE_DRIVER: 's3', S3_BUCKET: 'b', CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
    expect(loadEnv({ ...prod, SCANNER: 'clamav', STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }).COOKIE_SECURE).toBe(true);
  });

  test('mail provider credentials are required for the chosen provider', () => {
    expect(() => loadEnv({ ...valid, MAIL_PROVIDER: 'gmail' })).toThrow(/GMAIL_SMTP_USER/);
    expect(() => loadEnv({ ...valid, MAIL_PROVIDER: 'office365' })).toThrow(/M365_TENANT_ID/);
  });
});
