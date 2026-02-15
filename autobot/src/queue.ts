import { Queue } from 'bullmq';
import { CONFIG } from './config';
import { QueuedRun } from './types';
import { stableId } from './utils';
import { setJobStatus } from './state';

export const qaQueue = new Queue<QueuedRun, unknown, 'autobot-run'>(CONFIG.queueName, {
  connection: {
    url: CONFIG.redisUrl,
  },
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 200,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
      count: 200,
    },
  },
});

export async function enqueueRun(input: Omit<QueuedRun, 'jobId' | 'createdAt'>): Promise<string> {
  const jobId = input.idempotencyKey || stableId();
  await setJobStatus(jobId, {
    status: 'received',
    progressMessage: 'received request and preparing queue entry',
  });

  const existing = await qaQueue.getJob(jobId);
  if (existing) {
    return existing.id as string;
  }

  const payload: QueuedRun = {
    ...input,
    jobId,
    createdAt: new Date().toISOString(),
  };
  await qaQueue.add('autobot-run' as const, payload, {
    jobId,
  });
  await setJobStatus(jobId, {
    status: 'queued',
    progressMessage: 'run queued',
  });
  return jobId;
}
