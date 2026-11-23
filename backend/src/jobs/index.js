import { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { bullConnection } from '../database/redis.js';
import { getQueue } from './queues.js';
import { runSlaSweep } from './maintenance.js';
import { processMailJob } from '../modules/notifications/notifications.service.js';
import { scanVersion } from '../modules/documents/documents.service.js';
import { syncAllPending } from '../modules/approvals/approvals.service.js';
import { getSignatureProvider } from '../services/signature/provider.js';
import { processRateSetJob } from '../modules/asr/asr.service.js';

/**
 * Starts the BullMQ workers (RUN_MODE=worker, or in-process with RUN_MODE=all) and schedules repeatable jobs.
 * @returns {Promise<() => Promise<void>>} stop function
 */
async function startWorkers() {
  const opts = { connection: bullConnection(), prefix: env.QUEUE_PREFIX };
  const workers = [
    new Worker('mail', async (job) => processMailJob(job.data, job.attemptsMade), { ...opts, concurrency: 5 }),
    new Worker('scan', async (job) => scanVersion(job.data.versionId), { ...opts, concurrency: 2 }),
    new Worker(
      'maintenance',
      async (job) => {
        if (job.name === 'sla-sweep') return runSlaSweep();
        if (job.name === 'signature-sync') return syncAllPending();
        return null;
      },
      { ...opts, concurrency: 1 },
    ),
    // One eASR statement at a time across all worker processes (the client also spaces every request).
    new Worker('igr', async (job) => processRateSetJob(job.data), { ...opts, concurrency: 1 }),
  ];
  for (const w of workers) w.on('failed', (job, err) => logger.warn({ queue: w.name, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'Job failed'));

  await getQueue('igr').setGlobalConcurrency(1);
  const maintenance = getQueue('maintenance');
  await maintenance.upsertJobScheduler('sla-sweep', { every: 15 * 60_000 }, { name: 'sla-sweep' });
  if (!getSignatureProvider().synchronous) await maintenance.upsertJobScheduler('signature-sync', { every: 60_000 }, { name: 'signature-sync' });
  else await maintenance.removeJobScheduler('signature-sync').catch(() => undefined);
  logger.info('Background workers started (mail, scan, maintenance, igr)');

  return async () => {
    await Promise.all(workers.map((w) => w.close()));
  };
}

export { startWorkers };
