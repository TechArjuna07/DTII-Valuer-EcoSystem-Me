import { Router } from 'express';
import { prisma } from '../../database/prisma.js';
import { redis } from '../../database/redis.js';
import { documentRoute } from '../../docs/registry.js';

const router = Router();

/** Runs a dependency probe with a 3 s timeout. Never exposes error details. */
async function check(fn) {
  let timer;
  try {
    await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), 3000)))]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/** Liveness: the process is running. */
router.get('/live', (_req, res) => res.json({ status: 'ok' }));

/** Readiness: database and Redis reachable. 503 when a dependency is down. */
router.get('/ready', async (_req, res) => {
  const checks = {
    database: await check(() => prisma.$queryRaw`SELECT 1`),
    redis: await check(() => redis.ping()),
  };
  const ok = Object.values(checks).every((c) => c === 'up');
  res
    .status(ok ? 200 : 503)
    .json(ok ? { status: 'ok', checks } : { statusCode: 503, error: 'SERVICE_UNAVAILABLE', status: 'error', checks, message: 'Dependency check failed' });
});


documentRoute({ method: 'get', path: '/health/live', tag: 'Health', summary: 'Liveness probe', auth: false });
documentRoute({ method: 'get', path: '/health/ready', tag: 'Health', summary: 'Readiness probe (PostgreSQL, Redis); 503 when degraded', auth: false });
export default router;
