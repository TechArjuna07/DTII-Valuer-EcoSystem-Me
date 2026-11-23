import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { bullConnection } from '../database/redis.js';

/**
 * Background job queues (BullMQ on the dedicated Redis container):
 *   mail         email delivery with retries (5 attempts, exponential back-off)
 *   scan         malware scanning of uploaded versions (SCANNER=clamav)
 *   maintenance  repeatable jobs: SLA / overdue sweep, signature-provider polling
 *   igr          IGR Maharashtra eASR statement fetches (one at a time platform-wide)
 * Under NODE_ENV=test jobs are recorded in memory (testJobs) instead of being sent to Redis, so tests stay
 * deterministic; processors are exercised directly by the tests.
 */
const QUEUE_NAMES = ['mail', 'scan', 'maintenance', 'igr'];
const DEFAULT_JOB_OPTIONS = { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 };

const queues = new Map();
const testJobs = [];

function getQueue(name) {
  if (!QUEUE_NAMES.includes(name)) throw new Error(`Unknown queue ${name}`);
  if (!queues.has(name)) queues.set(name, new Queue(name, { connection: bullConnection(), prefix: env.QUEUE_PREFIX, defaultJobOptions: DEFAULT_JOB_OPTIONS }));
  return queues.get(name);
}

async function enqueue(name, jobName, data, opts = {}) {
  if (env.NODE_ENV === 'test') {
    testJobs.push({ queue: name, name: jobName, data, opts });
    return { id: `test-${testJobs.length}` };
  }
  return getQueue(name).add(jobName, data, opts);
}

async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
}

export { enqueue, getQueue, closeQueues, testJobs, QUEUE_NAMES, DEFAULT_JOB_OPTIONS };
