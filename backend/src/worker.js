import { logger } from './config/logger.js';
import { prisma } from './database/prisma.js';
import { redis } from './database/redis.js';
import { closeQueues } from './jobs/queues.js';
import { startWorkers } from './jobs/index.js';
import { registerNotificationRules } from './modules/notifications/rules.js';
import { closeRenderer } from './services/pdf/pdf-renderer.js';

/** Worker entry point (RUN_MODE=worker): background jobs only, no HTTP. Scale independently of the API. */
async function main() {
  registerNotificationRules();
  const stop = await startWorkers();
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Worker shutting down');
    await stop().catch(() => undefined);
    await closeQueues();
    await closeRenderer();
    await prisma.$disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Failed to start worker');
  process.exit(1);
});
