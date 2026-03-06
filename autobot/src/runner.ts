import path from "node:path";
import { normalizeBaseUrl, uniqueList } from "./utils";
import { CONFIG } from "./config";
import {
  AiTestReport,
  JobStatus,
  PhaseRecord,
  QueuedRun,
  RunEnvironment,
  RunReport,
  RunTotals,
} from "./types";
import { setJobStatus, setJobReport, ensureArtifactDir } from "./state";
import { resolveRouteSpecs } from "./manifest";
import { resolvePreviewUrl } from "./vercel";
import { runVisualChecks } from "./screenshotRunner";
import { judgeScreenshots } from "./judge";
import {
  aggregateRunTotals,
  buildPrComment,
  buildAiTestPrComment,
  writeJsonReport,
  writeMarkdownReport,
} from "./reporter";
import { postGithubCommentForActor } from "./github";
import { ensureEnvironment } from "./environmentManager";
import { agentFetch, executeBuildPipeline } from "./buildPipeline";
import { getRepoTokenForActor } from "./repoTokens";
import { runManagedVisualChecks } from "./managedScreenshotRunner";
import { crawlHomepageLinks } from "./crawl";

export interface ExecutionResult {
  reportPath: string;
  status: JobStatus;
}

const resolveEnvironmentUrl = async (request: QueuedRun): Promise<string> => {
  if (request.environment === "managed") {
    throw new Error(
      "managed environments use executeManagedRun — should not call resolveEnvironmentUrl",
    );
  }

  if (request.environment === "custom") {
    if (!request.baseUrl) {
      throw new Error("custom environment requires baseUrl");
    }
    return normalizeBaseUrl(request.baseUrl);
  }

  if (request.environment === "production") {
    if (!CONFIG.productionBaseUrl) {
      throw new Error("BASE_URL_PRODUCTION is not configured");
    }
    return normalizeBaseUrl(CONFIG.productionBaseUrl);
  }

  const previewFromPayload = request.baseUrl
    ? normalizeBaseUrl(request.baseUrl)
    : null;
  if (previewFromPayload) return previewFromPayload;

  const resolved = await resolvePreviewUrl({
    branch: request.branch,
    sha: request.sha,
  });

  if (resolved) return resolved;

  throw new Error(
    "Could not resolve preview URL for PR. Pass baseUrl manually via /qa run baseUrl=...",
  );
};

function determineStatusForRun(
  totals: RunTotals,
  includeJudge: boolean,
): RunReport["status"] {
  if (!includeJudge) {
    return totals.capturedPhases > 0 ? "succeeded" : "failed";
  }

  if (totals.blocking > 0) return "failed";
  if (totals.high >= CONFIG.failOnHighThreshold) return "partial";
  if (totals.score < CONFIG.minimumScore) return "failed";
  return "succeeded";
}

export async function executeRun(payload: QueuedRun): Promise<ExecutionResult> {
  const runId = payload.jobId;
  const createdAt = new Date().toISOString();
  const runDir = await ensureArtifactDir(runId);
  await setJobStatus(runId, {
    status: "running",
    progressMessage: "resolving base URL and routing plan",
  });

  let routeTokens = uniqueList(payload.routes);

  // For web-trial runs, crawl the homepage to discover additional routes
  if (payload.source === 'web-trial' && payload.baseUrl) {
    await setJobStatus(runId, {
      status: 'running',
      progressMessage: 'crawling homepage for routes',
    });
    const crawledRoutes = await crawlHomepageLinks(payload.baseUrl, CONFIG.freeTrialCrawlLinks);
    routeTokens = uniqueList([...routeTokens, ...crawledRoutes]);
  }

  const routeSpecs = resolveRouteSpecs(routeTokens);
  let baseUrl: string;
  let routeRecords: PhaseRecord[] = [];
  let status: JobStatus = "running";
  let statusReason = "";
  let aiTestReport: AiTestReport | null = null;

  try {
    const viewports = payload.viewports.slice(0, 3);

    if (payload.environment === "managed") {
      // ---- Managed environment: Fly Machine + agent pipeline ----
      if (!payload.repo || !payload.branch) {
        throw new Error("managed environment requires repo and branch");
      }

      await setJobStatus(runId, {
        status: "running",
        progressMessage: "provisioning managed environment",
      });

      const env = await ensureEnvironment(
        payload.repo,
        payload.actor ?? "unknown",
      );

      await setJobStatus(runId, {
        status: "running",
        progressMessage: "running build pipeline (clone, install, start)",
      });

      const repoId = `${payload.repo.owner}/${payload.repo.name}`;
      const accessToken = await getRepoTokenForActor(repoId, payload.actor);

      const buildResult = await executeBuildPipeline({
        environment: env,
        repo: payload.repo,
        branch: payload.branch,
        sha: payload.sha,
        accessToken,
      });

      if (!buildResult.success) {
        throw new Error(`Build pipeline failed: ${buildResult.error}`);
      }

      baseUrl = buildResult.devServerUrl;

      await setJobStatus(runId, {
        status: "running",
        progressMessage: `build complete (${buildResult.totalDurationMs}ms); capturing screenshots via agent`,
      });

      routeRecords = await runManagedVisualChecks({
        agentUrl: env.agentUrl,
        agentSecret: CONFIG.flyAgentSecret,
        jobId: runId,
        runDir,
        routeConfigs: routeSpecs,
        mode: payload.mode,
        viewports,
      });

      // Run AI test if configured (non-fatal — screenshots still get posted on failure)
      if (
        payload.testMode &&
        payload.testMode !== 'screenshots-only' &&
        CONFIG.aiTestEnabled
      ) {
        const aiMode = payload.testMode === 'agentic' ? 'agentic' : 'scriptgen';
        await setJobStatus(runId, {
          status: 'running',
          progressMessage: `running AI test (${aiMode} mode)`,
        });

        try {
          const aiResult = await agentFetch<{
            success: boolean;
            report: AiTestReport | null;
            screenshots: Record<string, string>;
            error?: string;
            durationMs: number;
          }>(env.agentUrl, '/run-ai-test', {
            mode: aiMode,
            budget: CONFIG.aiTestBudgetUsd,
          });

          if (aiResult.success && aiResult.report) {
            aiTestReport = aiResult.report;

            // Save AI test screenshots to run directory
            const aiScreenshotDir = path.join(runDir, 'ai-test-screenshots');
            const fsPromises = await import('node:fs/promises');
            await fsPromises.mkdir(aiScreenshotDir, { recursive: true });
            for (const [filename, base64] of Object.entries(aiResult.screenshots)) {
              await fsPromises.writeFile(
                path.join(aiScreenshotDir, filename),
                Buffer.from(base64 as string, 'base64'),
              );
            }
          } else if (aiResult.error) {
            console.error(`[runner] AI test failed: ${aiResult.error}`);
          }
        } catch (aiErr) {
          console.error('[runner] AI test call failed (non-fatal):', aiErr);
        }
      }
    } else {
      // ---- Existing flow: resolve external URL + local Playwright ----
      baseUrl = await resolveEnvironmentUrl(payload);
      await setJobStatus(runId, {
        status: "running",
        progressMessage: `resolved environment: ${baseUrl}`,
      });

      routeRecords = await runVisualChecks({
        jobId: runId,
        runDir,
        baseUrl,
        routeConfigs: routeSpecs,
        mode: payload.mode,
        viewports,
      });
    }

    await setJobStatus(runId, {
      status: "running",
      progressMessage: "captured screenshots; running AI judge",
    });

    if (payload.includeJudge) {
      routeRecords = await judgeScreenshots(routeRecords);
    }

    const totals = aggregateRunTotals(routeRecords);
    status = determineStatusForRun(totals, payload.includeJudge);

    if (CONFIG.failOnBlocking && totals.blocking > 0) {
      status = "failed";
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
    await setJobReport(runId, report);

    await setJobStatus(runId, {
      status,
      progressMessage: `run complete (${status})`,
      reportPath,
    });

    if (payload.repo && payload.prNumber && payload.source === "github") {
      const comment = aiTestReport
        ? buildAiTestPrComment(report, aiTestReport)
        : buildPrComment(report);
      try {
        await postGithubCommentForActor(
          payload.repo.owner,
          payload.repo.name,
          payload.prNumber,
          comment,
          payload.actor,
        );
      } catch (commentError) {
        console.error("[runner] failed to post GitHub comment", commentError);
      }
    }

    return { reportPath, status };
  } catch (error) {
    status = "failed";
    statusReason = error instanceof Error ? error.message : "unknown failure";

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
      environment: (payload.environment as RunEnvironment) || "custom",
      baseUrl: payload.baseUrl || "unknown",
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
    await setJobReport(runId, fallback);

    if (payload.repo && payload.prNumber && payload.source === "github") {
      const comment = buildPrComment(fallback);
      try {
        await postGithubCommentForActor(
          payload.repo.owner,
          payload.repo.name,
          payload.prNumber,
          comment,
          payload.actor,
        );
      } catch {
        // ignore
      }
    }

    return { reportPath, status };
  }
}
