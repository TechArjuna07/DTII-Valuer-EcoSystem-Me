import Redis from 'ioredis';
import { env } from '../config/env.js';

/** Shared connection for caching and rate limiting. BullMQ creates its own connections from bullConnection(). */
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: false });

/** Connection options for BullMQ (it requires maxRetriesPerRequest: null). */
function bullConnection() {
  const u = new URL(env.REDIS_URL);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export { redis, bullConnection };
