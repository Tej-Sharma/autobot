import { redis } from './redis';
import { getLead } from './leads';
import { addLeadRun } from './leads';
import { enqueueRun } from './queue';
import { sendReportEmail } from './email';
import { getJobStatus } from './state';
import { RunReport } from './types';
import fs from 'node:fs';

const MONITORS_PREFIX = 'autobot:monitors:';

export interface MonitoredUrl {
  url: string;
  email: string;
  intervalHours: number;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastJobId?: string;
  credentials?: string;
}

function monitorKey(email: string): string {
  return `${MONITORS_PREFIX}${email}`;
}

export async function getMonitors(email: string): Promise<MonitoredUrl[]> {
  const raw = await redis.get(monitorKey(email));
  return raw ? JSON.parse(raw) : [];
}

export async function addMonitor(email: string, url: string, intervalHours: number, credentials?: string): Promise<MonitoredUrl[]> {
  const monitors = await getMonitors(email);
  const existing = monitors.find(m => m.url === url);
  if (existing) {
    existing.intervalHours = intervalHours;
    existing.enabled = true;
    if (credentials !== undefined) existing.credentials = credentials;
  } else {
    monitors.push({
      url,
      email,
      intervalHours,
      enabled: true,
      createdAt: new Date().toISOString(),
      credentials,
    });
  }
  await redis.set(monitorKey(email), JSON.stringify(monitors));
  return monitors;
}

export async function removeMonitor(email: string, url: string): Promise<MonitoredUrl[]> {
  const monitors = await getMonitors(email);
  const filtered = monitors.filter(m => m.url !== url);
  await redis.set(monitorKey(email), JSON.stringify(filtered));
  return filtered;
}

export async function toggleMonitor(email: string, url: string, enabled: boolean): Promise<MonitoredUrl[]> {
  const monitors = await getMonitors(email);
  const monitor = monitors.find(m => m.url === url);
  if (monitor) monitor.enabled = enabled;
  await redis.set(monitorKey(email), JSON.stringify(monitors));
  return monitors;
}

// Called by the scheduler — finds all monitors due for a run and enqueues them
export async function runDueMonitors(): Promise<number> {
  const allEmails = await redis.smembers('autobot:leads');
  let enqueued = 0;

  for (const email of allEmails) {
    const lead = await getLead(email);
    if (!lead?.plan || lead.plan === 'free') continue;

    const monitors = await getMonitors(email);

    for (const monitor of monitors) {
      if (!monitor.enabled) continue;

      const intervalMs = monitor.intervalHours * 60 * 60 * 1000;
      const lastRun = monitor.lastRunAt ? new Date(monitor.lastRunAt).getTime() : 0;
      const now = Date.now();

      if (now - lastRun < intervalMs) continue;

      try {
        // Parse credentials string into key-value pairs for the AI agent
        const creds: Record<string, string> = {};
        if (monitor.credentials) {
          for (const part of monitor.credentials.split(/[,;\/]/).map(s => s.trim()).filter(Boolean)) {
            const sepIdx = part.indexOf(':');
            if (sepIdx > 0) {
              creds[part.slice(0, sepIdx).trim()] = part.slice(sepIdx + 1).trim();
            }
          }
        }
        const hasCredentials = Object.keys(creds).length > 0;

        const jobId = await enqueueRun({
          environment: 'custom',
          baseUrl: monitor.url,
          routes: ['/'],
          mode: 'smoke',
          viewports: [{ name: 'desktop', width: 1280, height: 720 }],
          includeJudge: true,
          testMode: 'screenshots-only',
          source: 'web-trial',
          sourceMetadata: { email, monitor: true, scheduled: true },
          credentials: hasCredentials ? creds : undefined,
        });

        monitor.lastRunAt = new Date().toISOString();
        monitor.lastJobId = jobId;
        await addLeadRun(email, jobId);
        enqueued++;

        // Schedule email notification after run completes (check after 2 min)
        schedulePostRunEmail(email, jobId, monitor.url);
      } catch (err) {
        console.error(`[scheduler] failed to enqueue monitor for ${email} / ${monitor.url}:`, err);
      }
    }

    // Save updated lastRunAt timestamps
    await redis.set(monitorKey(email), JSON.stringify(monitors));
  }

  return enqueued;
}

function schedulePostRunEmail(email: string, jobId: string, url: string): void {
  // Poll for completion, then send email
  let attempts = 0;
  const maxAttempts = 30; // 5 min max
  const interval = setInterval(async () => {
    attempts++;
    try {
      const status = await getJobStatus(jobId);
      if (!status) { clearInterval(interval); return; }

      const terminal = ['succeeded', 'partial', 'failed'].includes(status.status);
      if (!terminal && attempts < maxAttempts) return;

      clearInterval(interval);

      if (status.reportPath && fs.existsSync(status.reportPath)) {
        try {
          const report = JSON.parse(fs.readFileSync(status.reportPath, 'utf8')) as RunReport;
          await sendReportEmail(email, jobId, report);
          console.log(`[scheduler] sent report email to ${email} for ${url}`);
        } catch {
          // best effort
        }
      }
    } catch {
      if (attempts >= maxAttempts) clearInterval(interval);
    }
  }, 10_000);
}
