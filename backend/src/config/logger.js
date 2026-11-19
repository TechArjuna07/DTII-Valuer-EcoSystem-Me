import pino from 'pino';
import { env } from './env.js';

/** Paths never written to logs: credentials, tokens, cookies, PAN, SMTP secrets. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.pan',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.smtpPassword',
  '*.clientSecret',
];

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'valuers-api' },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
});

export { logger, REDACT_PATHS };
