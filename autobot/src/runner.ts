import path from 'node:path';
import { normalizeBaseUrl, uniqueList } from './utils';
import { CONFIG } from './config';
import { JobStatus, PhaseRecord, QueuedRun, RunEnvironment, RunReport, RunTotals } from './types';
import { setJobStatus, ensureArtifactDir } from './state';
import { resolveRouteSpecs } from './manifest';
import { resolvePreviewUrl } from './vercel';
import { runVisualChecks } from './screenshotRunner';
import { judgeScreenshots } from './judge';
import { aggregateRunTotals, buildPrComment, writeJsonReport, writeMarkdownReport } from './reporter';
import { postGithubCommentForActor } from './github';

export interface ExecutionResult {
  reportPath: string;
  status: JobStatus;
}

const resolveEnvironmentUrl = async (request: QueuedRun): Promise<string> => {
  if (request.environment === 'custom') {
    if (!request.baseUrl) {
      throw new Error('custom environment requires baseUrl');
    }
    return normalizeBaseUrl(request.baseUrl);
  }

  if (request.environment === 'production') {
    if (!CONFIG.productionBaseUrl) {
      throw new Error('BASE_URL_PRODUCTION is not configured');
    }
    return normalizeBaseUrl(CONFIG.productionBaseUrl);
  }

  const previewFromPayload = request.baseUrl ? normalizeBaseUrl(request.baseUrl) : null;
  if (previewFromPayload) return previewFromPayload;

  const resolved = await resolvePreviewUrl({
    branch: request.branch,
    sha: request.sha,
  });

  if (resolved) return resolved;

  throw new Error('Could not resolve preview URL for PR. Pass baseUrl manually via /qa run baseUrl=...');
};

function determineStatusForRun(totals: RunTotals, includeJudge: boolean): RunReport['status'] {
  if (!includeJudge) {
    return totals.capturedPhases > 0 ? 'succeeded' : 'failed';
  }

  if (totals.blocking > 0) return 'failed';
  if (totals.high >= CONFIG.failOnHighThreshold) return 'partial';
  if (totals.score < CONFIG.minimumScore) return 'failed';
  return 'succeeded';
}

export async function executeRun(payload: QueuedRun): Promise<ExecutionResult> {
  const runId = payload.jobId;
  const createdAt = new Date().toISOString();
  const runDir = await ensureArtifactDir(runId);
  await setJobStatus(runId, {
    status: 'running',
    progressMessage: 'resolving base URL and routing plan',
  });

  const routeTokens = uniqueList(payload.routes);
  const routeSpecs = resolveRouteSpecs(routeTokens);
  let baseUrl: string;
  let routeRecords: PhaseRecord[] = [];
  let status: JobStatus = 'running';
  let statusReason = '';

  try {
    baseUrl = await resolveEnvironmentUrl(payload);
    await setJobStatus(runId, {
      status: 'running',
      progressMessage: `resolved environment: ${baseUrl}`,
    });

    const viewports = payload.viewports.slice(0, 3);
    routeRecords = await runVisualChecks({
      jobId: runId,
      runDir,
      baseUrl,
      routeConfigs: routeSpecs,
      mode: payload.mode,
      viewports,
    });

    await setJobStatus(runId, {
      status: 'running',
      progressMessage: 'captured screenshots; running AI judge',
    });

    if (payload.includeJudge) {
      routeRecords = await judgeScreenshots(routeRecords);
    }

    const totals = aggregateRunTotals(routeRecords);
    status = determineStatusForRun(totals, payload.includeJudge);

    if (CONFIG.failOnBlocking && totals.blocking > 0) {
      status = 'failed';
    }

    const report: RunReport = {
      jobId: runId,
      createdAt,
      updatedAt: new Date().toISOString(),
      status,
      statusReason: statusReason || undefined,
      environment: payload.environment,
      baseUrl,
      mode: payload.mode,
      routeCount: routeSpecs.length,
      viewportCount: viewports.length,
      includeJudge: payload.includeJudge,
      source: payload.source,
      phases: routeRecords,
      totals,
      config: {
        runMode: payload.mode,
        viewports,
        routeSpecs: routeSpecs.map((entry) => entry.key),
        actor: payload.actor,
        environment: payload.environment,
        branch: payload.branch,
        sha: payload.sha,
        artifactRoot: path.resolve(runDir),
      },
    };

    const reportPath = await writeJsonReport(runId, report);
    const markdownPath = await writeMarkdownReport(runId, report);

    await setJobStatus(runId, {
      status,
      progressMessage: `run complete (${status})`,
      reportPath,
    });

    if (payload.repo && payload.prNumber && payload.source === 'github') {
      const comment = buildPrComment(report);
      try {
        await postGithubCommentForActor(payload.repo.owner, payload.repo.name, payload.prNumber, comment, payload.actor);
      } catch (commentError) {
        console.error('[runner] failed to post GitHub comment', commentError);
      }
    }

    return { reportPath, status };
  } catch (error) {
    status = 'failed';
    statusReason = error instanceof Error ? error.message : 'unknown failure';

    await setJobStatus(runId, {
      status,
      progressMessage: statusReason,
      error: statusReason,
    });

    const fallback: RunReport = {
      jobId: runId,
      createdAt,
      updatedAt: new Date().toISOString(),
      status,
      statusReason,
      environment: (payload.environment as RunEnvironment) || 'custom',
      baseUrl: payload.baseUrl || 'unknown',
      mode: payload.mode,
      routeCount: routeSpecs.length,
      viewportCount: payload.viewports.length,
      includeJudge: payload.includeJudge,
      source: payload.source,
      phases: routeRecords,
      totals: {
        score: 0,
        blocking: 1,
        high: 0,
        medium: 0,
        low: 0,
        capturedPhases: 0,
        failedPhases: payload.routes.length * payload.viewports.length,
      },
      config: {
        runMode: payload.mode,
        viewports: payload.viewports,
        routeSpecs: routeSpecs.map((entry) => entry.key),
        actor: payload.actor,
        environment: payload.environment,
        branch: payload.branch,
        sha: payload.sha,
        artifactRoot: path.resolve(runDir),
      },
    };

    const reportPath = await writeJsonReport(runId, fallback);
    await writeMarkdownReport(runId, fallback);

    if (payload.repo && payload.prNumber && payload.source === 'github') {
      const comment = buildPrComment(fallback);
      try {
        await postGithubCommentForActor(payload.repo.owner, payload.repo.name, payload.prNumber, comment, payload.actor);
      } catch {
        // ignore
      }
    }

    return { reportPath, status };
  }
}
