import { Worker } from 'bullmq';
import { CONFIG } from './config';
import { setJobStatus } from './state';
import { executeRun } from './runner';
import { qaQueue } from './queue';
import { QueuedRun } from './types';

const worker = new Worker<QueuedRun, unknown, 'autobot-run'>(
  CONFIG.queueName,
  async (job) => {
    await setJobStatus(job.data.jobId, {
      status: 'running',
      progressMessage: 'worker started',
      reportPath: undefined,
      error: undefined,
    });
    const result = await executeRun(job.data);
    return result;
  },
  {
    connection: {
      url: CONFIG.redisUrl,
    },
    concurrency: CONFIG.concurrency,
  },
);

worker.on('failed', async (job, err) => {
  if (!job) return;
  await setJobStatus(job.data.jobId, {
    status: 'failed',
    progressMessage: 'worker failure',
    error: err?.message || 'unknown worker failure',
  });
});

worker.on('completed', async (job, _result) => {
  if (!job) return;
  console.log(`[worker] completed run ${job.id}`);
});

worker.on('error', (error) => {
  console.error('[worker] error', error);
});

const drainQueueEvents = async () => {
  try {
    const counts = await qaQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
    console.log('[worker] queue counts', counts);
  } catch {
    // ignore
  }
};

drainQueueEvents();

console.log('[worker] running with concurrency', CONFIG.concurrency);
