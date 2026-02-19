import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config';
import { ManifestMatch, PhaseRecord, RunMode, ViewportSetting } from './types';

interface ManagedScreenshotInput {
  agentUrl: string;
  agentSecret?: string;
  jobId: string;
  runDir: string;
  routeConfigs: ManifestMatch[];
  mode: RunMode;
  viewports: ViewportSetting[];
}

interface AgentScreenshotPhase {
  routeKey: string;
  routePath: string;
  phase: string;
  viewport: string;
  screenshotBase64: string;
  url: string;
  status: 'captured' | 'skipped' | 'failed';
  error?: string;
}

interface AgentScreenshotResult {
  success: boolean;
  phases: AgentScreenshotPhase[];
  durationMs: number;
  error?: string;
}

/**
 * Capture screenshots via the agent running inside a Fly Machine.
 * The agent runs Playwright against localhost and returns base64 screenshots.
 * We save them to the artifact directory and return PhaseRecords
 * compatible with the existing judge pipeline.
 */
export async function runManagedVisualChecks(
  input: ManagedScreenshotInput,
): Promise<PhaseRecord[]> {
  const { agentUrl, agentSecret, jobId, runDir, routeConfigs, mode, viewports } = input;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agentSecret) {
    headers['Authorization'] = `Bearer ${agentSecret}`;
  }

  const res = await fetch(`${agentUrl}/screenshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      routes: routeConfigs.map((rc) => ({
        key: rc.spec.key,
        path: rc.spec.path,
        ctaSelectors: rc.spec.ctaSelectors,
      })),
      viewports,
      mode,
    }),
    signal: AbortSignal.timeout(300_000), // 5 min for all screenshots
  });

  const result = (await res.json()) as AgentScreenshotResult;

  if (!res.ok || !result.success) {
    console.error('[managedScreenshotRunner] agent screenshot failed:', result.error);
  }

  // Convert agent phases to PhaseRecords, saving base64 images to disk
  const records: PhaseRecord[] = [];

  for (const phase of result.phases ?? []) {
    const dir = path.join(runDir, phase.routeKey, phase.viewport);
    await fs.mkdir(dir, { recursive: true });

    let screenshotPath = '';

    if (phase.status === 'captured' && phase.screenshotBase64) {
      const filename = `${phase.phase}.png`;
      screenshotPath = path.join(dir, filename);
      await fs.writeFile(screenshotPath, Buffer.from(phase.screenshotBase64, 'base64'));
    }

    records.push({
      routeKey: phase.routeKey,
      routePath: phase.routePath,
      phase: phase.phase,
      viewport: phase.viewport,
      screenshotPath,
      url: phase.url,
      status: phase.status,
      error: phase.error,
    });
  }

  return records;
}
