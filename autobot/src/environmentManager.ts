import { redis } from './redis';
import { CONFIG } from './config';
import { FlyProvider } from './providers/flyProvider';
import { EnvironmentProvider, EnvironmentStatus } from './providers/types';
import { RepoRef } from './types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UserEnvironment {
  repoFullName: string;
  actor: string;
  machineId: string;
  volumeId: string;
  region: string;
  agentUrl: string;
  status: EnvironmentStatus;
  createdAt: string;
  lastActiveAt: string;
}

const ENV_PREFIX = 'autobot:env:';
const ENV_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days

/* ------------------------------------------------------------------ */
/*  Provider singleton                                                 */
/* ------------------------------------------------------------------ */

let _provider: EnvironmentProvider | undefined;

function getProvider(): EnvironmentProvider {
  if (!_provider) {
    _provider = new FlyProvider();
  }
  return _provider;
}

/* ------------------------------------------------------------------ */
/*  Redis helpers                                                      */
/* ------------------------------------------------------------------ */

function envKey(repoFullName: string): string {
  return `${ENV_PREFIX}${repoFullName.toLowerCase()}`;
}

async function loadEnv(repoFullName: string): Promise<UserEnvironment | null> {
  const raw = await redis.get(envKey(repoFullName));
  return raw ? (JSON.parse(raw) as UserEnvironment) : null;
}

async function saveEnv(env: UserEnvironment): Promise<void> {
  await redis.set(envKey(env.repoFullName), JSON.stringify(env), 'EX', ENV_TTL_SECONDS);
}

async function deleteEnv(repoFullName: string): Promise<void> {
  await redis.del(envKey(repoFullName));
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ensure a running environment exists for the given repo.
 * - If no environment exists → create machine + volume on Fly.
 * - If environment is stopped → start it.
 * - If already running → touch lastActiveAt and return.
 */
export async function ensureEnvironment(
  repo: RepoRef,
  actor: string,
): Promise<UserEnvironment> {
  const repoFullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const existing = await loadEnv(repoFullName);

  if (existing) {
    const provider = getProvider();

    // Refresh status from the provider
    try {
      existing.status = await provider.getStatus(existing.machineId);
    } catch {
      // Machine may have been deleted externally — recreate below
      await deleteEnv(repoFullName);
      return createNewEnvironment(repoFullName, actor);
    }

    if (existing.status === 'running') {
      existing.lastActiveAt = new Date().toISOString();
      await saveEnv(existing);
      return existing;
    }

    if (existing.status === 'stopped') {
      existing.status = 'starting';
      existing.lastActiveAt = new Date().toISOString();
      await saveEnv(existing);

      await provider.startEnvironment(existing.machineId);
      existing.status = 'running';
      await saveEnv(existing);
      return existing;
    }

    if (existing.status === 'destroyed' || existing.status === 'failed') {
      await deleteEnv(repoFullName);
      return createNewEnvironment(repoFullName, actor);
    }

    // starting/stopping/provisioning — wait for it
    await provider.waitForState(existing.machineId, 'running', 90_000);
    existing.status = 'running';
    existing.lastActiveAt = new Date().toISOString();
    await saveEnv(existing);
    return existing;
  }

  return createNewEnvironment(repoFullName, actor);
}

async function createNewEnvironment(
  repoFullName: string,
  actor: string,
): Promise<UserEnvironment> {
  const provider = getProvider();
  const envName = `env-${repoFullName.replace(/\//g, '-')}`;

  const result = await provider.createEnvironment({
    name: envName,
    region: CONFIG.flyRegion,
    image: CONFIG.flyMachineImage,
    cpus: CONFIG.flyMachineCpus,
    memoryMb: CONFIG.flyMachineMemoryMb,
    volumeSizeGb: CONFIG.flyVolumeSizeGb,
    env: {
      AUTOBOT_AGENT_SECRET: CONFIG.flyAgentSecret ?? '',
      REPO_FULL_NAME: repoFullName,
    },
    metadata: {
      repo: repoFullName,
      actor,
    },
  });

  const env: UserEnvironment = {
    repoFullName,
    actor,
    machineId: result.machineId,
    volumeId: result.volumeId,
    region: result.region,
    agentUrl: result.agentUrl,
    status: 'running',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };

  await saveEnv(env);
  return env;
}

/**
 * Stop a running environment. Machine and volume persist.
 */
export async function stopEnvironment(repo: RepoRef): Promise<void> {
  const repoFullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const env = await loadEnv(repoFullName);
  if (!env) return;

  const provider = getProvider();
  try {
    await provider.stopEnvironment(env.machineId);
  } catch (err) {
    console.error(`[envManager] failed to stop ${repoFullName}:`, err);
  }

  env.status = 'stopped';
  await saveEnv(env);
}

/**
 * Destroy an environment permanently — machine + volume deleted.
 * Used when a user cancels their subscription.
 */
export async function destroyEnvironment(repo: RepoRef): Promise<void> {
  const repoFullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const env = await loadEnv(repoFullName);
  if (!env) return;

  const provider = getProvider();
  try {
    await provider.destroyEnvironment(env.machineId, env.volumeId);
  } catch (err) {
    console.error(`[envManager] failed to destroy ${repoFullName}:`, err);
  }

  await deleteEnv(repoFullName);
}

/**
 * Get the current state of an environment.
 */
export async function getEnvironmentStatus(
  repo: RepoRef,
): Promise<UserEnvironment | null> {
  const repoFullName = `${repo.owner}/${repo.name}`.toLowerCase();
  const env = await loadEnv(repoFullName);
  if (!env) return null;

  // Refresh from provider
  try {
    const provider = getProvider();
    env.status = await provider.getStatus(env.machineId);
    await saveEnv(env);
  } catch {
    // Could not reach provider — return cached status
  }

  return env;
}

/**
 * List all environments for a given actor (scans Redis keys).
 */
export async function listUserEnvironments(
  actor: string,
): Promise<UserEnvironment[]> {
  const keys = await redis.keys(`${ENV_PREFIX}*`);
  const envs: UserEnvironment[] = [];

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const env = JSON.parse(raw) as UserEnvironment;
    if (env.actor.toLowerCase() === actor.toLowerCase()) {
      envs.push(env);
    }
  }

  return envs;
}

/**
 * List ALL environments (for idle monitoring).
 */
export async function listAllEnvironments(): Promise<UserEnvironment[]> {
  const keys = await redis.keys(`${ENV_PREFIX}*`);
  const envs: UserEnvironment[] = [];

  for (const key of keys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    envs.push(JSON.parse(raw) as UserEnvironment);
  }

  return envs;
}
