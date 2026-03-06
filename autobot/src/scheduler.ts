import { runDueMonitors } from './monitors';
import { CONFIG } from './config';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  // Check for due monitors every 5 minutes
  const checkIntervalMs = 5 * 60 * 1000;

  console.log('[scheduler] starting monitor scheduler (checking every 5 min)');

  // Run once on startup after a short delay
  setTimeout(async () => {
    try {
      const count = await runDueMonitors();
      if (count > 0) console.log(`[scheduler] enqueued ${count} scheduled monitor run(s)`);
    } catch (err) {
      console.error('[scheduler] error on startup check:', err);
    }
  }, 10_000);

  schedulerInterval = setInterval(async () => {
    try {
      const count = await runDueMonitors();
      if (count > 0) console.log(`[scheduler] enqueued ${count} scheduled monitor run(s)`);
    } catch (err) {
      console.error('[scheduler] error:', err);
    }
  }, checkIntervalMs);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
