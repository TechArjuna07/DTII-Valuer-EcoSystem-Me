import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const list = (s) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Validated, frozen environment. The process refuses to start on invalid configuration. */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    RUN_MODE: z.enum(['all', 'api', 'worker']).default('all'),
    PORT: z.coerce.number().int().default(4100),
    APP_NAME: z.string().default('Valuers Ecosystem'),
    WEB_APP_URL: z.string().url(),
    CORS_ORIGINS: z.string().transform(list),
    TRUST_PROXY: bool.prefault('false'),
    SWAGGER_ENABLED: bool.prefault('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().min(1),
    QUEUE_PREFIX: z.string().default('valuers'),

    JWT_ACCESS_SECRET: z.string().min(64, 'must be at least 64 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    JWT_ISSUER: z.string().default('valuers-api'),
    JWT_AUDIENCE: z.string().default('valuers-web'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    COOKIE_SECURE: bool.prefault('true'),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
    HMAC_KEY: z.string().min(32),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().min(1).default('./storage'),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(900).default(60),
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(200).default(25),
    S3_REGION: z.string().default('ap-south-1'),
    S3_BUCKET: z.string().optional(),
    S3_PREFIX: z.string().default('valuers/'),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    MAIL_PROVIDER: z.enum(['log', 'gmail', 'office365']).default('log'),
    MAIL_FROM: z.string().min(3).default('Valuers Ecosystem <no-reply@example.com>'),
    GMAIL_SMTP_USER: z.string().optional(),
    GMAIL_SMTP_APP_PASSWORD: z.string().optional(),
    M365_TENANT_ID: z.string().optional(),
    M365_CLIENT_ID: z.string().optional(),
    M365_CLIENT_SECRET: z.string().optional(),
    M365_SENDER: z.string().optional(),

    SCANNER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().default('127.0.0.1'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),

    THROTTLE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
    AUTH_THROTTLE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  })
  .superRefine((env, ctx) => {
    const need = (keys, why) =>
      keys.forEach((k) => {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `required when ${why}` });
      });
    if (env.STORAGE_DRIVER === 's3') need(['S3_BUCKET'], 'STORAGE_DRIVER=s3');
    if (env.MAIL_PROVIDER === 'gmail') need(['GMAIL_SMTP_USER', 'GMAIL_SMTP_APP_PASSWORD'], 'MAIL_PROVIDER=gmail');
    if (env.MAIL_PROVIDER === 'office365') need(['M365_TENANT_ID', 'M365_CLIENT_ID', 'M365_CLIENT_SECRET', 'M365_SENDER'], 'MAIL_PROVIDER=office365');
    if (env.NODE_ENV === 'production') {
      if (env.SCANNER === 'none') ctx.addIssue({ code: 'custom', path: ['SCANNER'], message: 'SCANNER=none is not allowed in production' });
      if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
      if (env.CORS_ORIGINS.includes('*')) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'wildcard CORS is not allowed' });
      if (env.STORAGE_DRIVER !== 's3') ctx.addIssue({ code: 'custom', path: ['STORAGE_DRIVER'], message: 'use s3 in production' });
    }
  });

/** Parses the given source. Errors list variable names and reasons only — never values. */
function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}

const env = loadEnv();

export { env, loadEnv };
