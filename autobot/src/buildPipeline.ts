import { CONFIG } from './config';
import { UserEnvironment } from './environmentManager';
import { RepoRef } from './types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BuildPipelineInput {
  environment: UserEnvironment;
  repo: RepoRef;
  branch: string;
  sha?: string;
  accessToken?: string;
}

export interface BuildPipelineResult {
  devServerUrl: string;
  devServerPort: number;
  success: boolean;
  cloneDurationMs: number;
  installDurationMs: number;
  installSkipped: boolean;
  dockerServices: string[];
  startDurationMs: number;
  totalDurationMs: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Agent HTTP helpers                                                 */
/* ------------------------------------------------------------------ */

async function agentFetch<T>(agentUrl: string, path: string, body?: unknown): Promise<T> {
  const url = `${agentUrl}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CONFIG.flyAgentSecret) {
    headers['Authorization'] = `Bearer ${CONFIG.flyAgentSecret}`;
  }

  const res = await fetch(url, {
    method: body !== undefined ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(600_000), // 10 min max per call
  });

  const text = await res.text();
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new Error(`Agent ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    const errMsg = (parsed as Record<string, unknown>)?.error ?? text.slice(0, 200);
    throw new Error(`Agent ${path} failed (${res.status}): ${errMsg}`);
  }

  return parsed;
}

/* ------------------------------------------------------------------ */
/*  Pipeline                                                           */
/* ------------------------------------------------------------------ */

/**
 * Execute the full build pipeline on a running Fly Machine:
 * clone → install → docker-up → start dev server.
 */
export async function executeBuildPipeline(
  input: BuildPipelineInput,
): Promise<BuildPipelineResult> {
  const start = Date.now();
  const { environment, repo, branch, sha, accessToken } = input;
  const agentUrl = environment.agentUrl;

  let cloneDurationMs = 0;
  let installDurationMs = 0;
  let installSkipped = false;
  let dockerServices: string[] = [];
  let startDurationMs = 0;

  try {
    // 1. Clone / fetch+checkout
    const cloneResult = await agentFetch<{
      success: boolean;
      sha: string;
      durationMs: number;
      error?: string;
    }>(agentUrl, '/clone', {
      repoUrl: `https://github.com/${repo.owner}/${repo.name}.git`,
      branch,
      sha,
      accessToken,
    });

    if (!cloneResult.success) {
      throw new Error(`Clone failed: ${cloneResult.error}`);
    }
    cloneDurationMs = cloneResult.durationMs;

    // 2. Install dependencies
    const installResult = await agentFetch<{
      success: boolean;
      skipped: boolean;
      durationMs: number;
      error?: string;
    }>(agentUrl, '/install', {});

    if (!installResult.success) {
      throw new Error(`Install failed: ${installResult.error}`);
    }
    installDurationMs = installResult.durationMs;
    installSkipped = installResult.skipped;

    // 3. Detect project config
    const projectConfig = await agentFetch<{
      hasDockerCompose: boolean;
      dockerComposeFile?: string;
    }>(agentUrl, '/detect');

    // 4. Docker services (if needed)
    if (projectConfig.hasDockerCompose) {
      const dockerResult = await agentFetch<{
        success: boolean;
        services: string[];
        durationMs: number;
        error?: string;
      }>(agentUrl, '/docker-up', {
        composeFile: projectConfig.dockerComposeFile,
      });

      if (!dockerResult.success) {
        console.warn(`[buildPipeline] docker-up failed: ${dockerResult.error} — continuing without docker services`);
      } else {
        dockerServices = dockerResult.services;
      }
    }

    // 5. Start dev server
    const startResult = await agentFetch<{
      success: boolean;
      port: number;
      url: string;
      durationMs: number;
      error?: string;
    }>(agentUrl, '/start', {});

    if (!startResult.success) {
      throw new Error(`Dev server start failed: ${startResult.error}`);
    }
    startDurationMs = startResult.durationMs;

    return {
      devServerUrl: `${agentUrl}`, // Playwright inside the machine hits localhost, but external access goes through Fly proxy
      devServerPort: startResult.port,
      success: true,
      cloneDurationMs,
      installDurationMs,
      installSkipped,
      dockerServices,
      startDurationMs,
      totalDurationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      devServerUrl: '',
      devServerPort: 0,
      success: false,
      cloneDurationMs,
      installDurationMs,
      installSkipped,
      dockerServices,
      startDurationMs,
      totalDurationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'build pipeline failed',
    };
  }
}
