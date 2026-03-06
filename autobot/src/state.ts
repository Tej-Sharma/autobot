import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config';
import { redis } from './redis';
import { StatusRecord } from './types';

const STATUS_PREFIX = 'autobot:status:';

const nowIso = () => new Date().toISOString();

export async function setJobStatus(
  id: string,
  status: Omit<StatusRecord, 'updatedAt' | 'createdAt' | 'id'>,
): Promise<void> {
  const key = `${STATUS_PREFIX}${id}`;
  const existing = await redis.get(key);
  const previous: StatusRecord | undefined = existing ? (JSON.parse(existing) as StatusRecord) : undefined;

  const payload: StatusRecord = {
    id,
    createdAt: previous?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    status: status.status,
    progressMessage: status.progressMessage,
    reportPath: status.reportPath,
    error: status.error,
  };

  await redis.set(key, JSON.stringify(payload), 'EX', CONFIG.jobStatusTtlSeconds);
}

export async function getJobStatus(id: string): Promise<StatusRecord | null> {
  const key = `${STATUS_PREFIX}${id}`;
  const value = await redis.get(key);
  return value ? (JSON.parse(value) as StatusRecord) : null;
}

const REPORT_PREFIX = 'autobot:report:';

export async function setJobReport(id: string, report: unknown): Promise<void> {
  await redis.set(`${REPORT_PREFIX}${id}`, JSON.stringify(report), 'EX', CONFIG.jobStatusTtlSeconds);
}

export async function getJobReport(id: string): Promise<unknown | null> {
  const value = await redis.get(`${REPORT_PREFIX}${id}`);
  return value ? JSON.parse(value) : null;
}

export async function ensureArtifactDir(jobId: string): Promise<string> {
  const dir = path.join(CONFIG.artifactRoot, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
