import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redis } from '../database/redis.js';

/**
 * Per-IP, per-minute limiter with counters in Redis, so limits hold across all API replicas.
 * @param {string} name   unique key prefix
 * @param {number} limit  requests per minute
 */
function createLimiter(name, limit) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({ prefix: `${env.QUEUE_PREFIX}:throttle:${name}:`, sendCommand: (...args) => redis.call(...args) }),
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req, res) =>
      res.status(429).json({
        statusCode: 429,
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many requests. Please try again later.',
        requestId: req.id ? String(req.id) : undefined,
      }),
  });
}

const limiters = {
  global: createLimiter('global', env.THROTTLE_LIMIT_PER_MINUTE),
  /** Login / reset / invite: strict per-IP limit (per-account lockout applies as well). */
  auth: createLimiter('auth', env.AUTH_THROTTLE_LIMIT_PER_MINUTE),
  /** Refresh runs on every page load / tab, so it has its own budget. */
  refresh: createLimiter('refresh', env.REFRESH_THROTTLE_LIMIT_PER_MINUTE),
  /** Uploads per IP per minute (a field team on one mobile network shares an IP; tune per deployment). */
  upload: createLimiter('upload', env.UPLOAD_THROTTLE_LIMIT_PER_MINUTE),
};

export { limiters, createLimiter };
