import { CONFIG } from './config';
import { listAllEnvironments, stopEnvironment } from './environmentManager';

const INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

let timer: ReturnType<typeof setInterval> | undefined;

async function checkIdleEnvironments(): Promise<void> {
  try {
    const envs = await listAllEnvironments();
    const now = Date.now();
    const idleThresholdMs = CONFIG.flyIdleTimeoutMinutes * 60 * 1000;

    for (const env of envs) {
      if (env.status !== 'running') continue;

      const lastActive = new Date(env.lastActiveAt).getTime();
      const idleMs = now - lastActive;

      if (idleMs > idleThresholdMs) {
        const [owner, name] = env.repoFullName.split('/');
        console.log(
          `[idleMonitor] stopping idle environment ${env.repoFullName} (idle ${Math.round(idleMs / 60_000)}min)`,
        );
        try {
          await stopEnvironment({ owner, name });
        } catch (err) {
          console.error(`[idleMonitor] failed to stop ${env.repoFullName}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('[idleMonitor] scan failed:', err);
  }
}

export function startIdleMonitor(): void {
  if (timer) return;
  console.log(
    `[idleMonitor] started (check every ${INTERVAL_MS / 1000}s, idle threshold ${CONFIG.flyIdleTimeoutMinutes}min)`,
  );
  timer = setInterval(checkIdleEnvironments, INTERVAL_MS);
  // Also run immediately on startup
  checkIdleEnvironments();
}

export function stopIdleMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
    console.log('[idleMonitor] stopped');
  }
}
