import { redis } from './redis';
import type { TestMode } from './types';

export interface RepoConfig {
  testMode: TestMode;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
}

const REPO_CONFIG_PREFIX = 'autobot:repo-config:';
const CONFIG_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

function configKey(repoFullName: string): string {
  return `${REPO_CONFIG_PREFIX}${repoFullName.toLowerCase()}`;
}

export async function getRepoConfig(repoFullName: string): Promise<RepoConfig | null> {
  const raw = await redis.get(configKey(repoFullName));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoConfig;
  } catch {
    return null;
  }
}

export async function setRepoConfig(
  repoFullName: string,
  config: Partial<RepoConfig> & { updatedBy: string },
): Promise<RepoConfig> {
  const existing = await getRepoConfig(repoFullName);
  const merged: RepoConfig = {
    testMode: config.testMode ?? existing?.testMode ?? 'screenshots-only',
    enabled: config.enabled ?? existing?.enabled ?? true,
    updatedAt: new Date().toISOString(),
    updatedBy: config.updatedBy,
  };
  await redis.set(configKey(repoFullName), JSON.stringify(merged), 'EX', CONFIG_TTL_SECONDS);
  return merged;
}

export async function deleteRepoConfig(repoFullName: string): Promise<void> {
  await redis.del(configKey(repoFullName));
}
