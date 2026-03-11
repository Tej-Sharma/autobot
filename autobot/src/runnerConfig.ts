import { isHttpError, parseCommaSeparated, stableId, uniqueList } from './utils';
import { CONFIG } from './config';
import { JobStatus, RunMode, RunRequest, ViewportSetting } from './types';

export const ALLOWED_ENVIRONMENTS = ['preview', 'production', 'custom', 'managed'] as const;
export const ALLOWED_MODES = ['minimal', 'smoke', 'full'] as const;

export interface TriggerParseResult {
  request: RunRequest;
  validationErrors: string[];
}

export function parseRunPayload(raw: Record<string, unknown>): TriggerParseResult {
  const validationErrors: string[] = [];
  const request: RunRequest = {
    environment: 'preview',
    routes: CONFIG.defaultRoutes,
    mode: CONFIG.defaultMode,
    viewports: CONFIG.defaultViewports,
    includeJudge: CONFIG.defaultJudge,
    source: 'api',
    sourceMetadata: {},
  };

  try {
    const env = typeof raw.environment === 'string' ? raw.environment.toLowerCase() : undefined;
    if (env && ALLOWED_ENVIRONMENTS.includes(env as never)) request.environment = env as RunRequest['environment'];

    const mode = typeof raw.mode === 'string' ? raw.mode.toLowerCase() : undefined;
    if (mode && ALLOWED_MODES.includes(mode as never)) request.mode = mode as RunMode;

    const routesFromPayload =
      typeof raw.routes === 'string'
        ? parseCommaSeparated(raw.routes)
        : Array.isArray(raw.routes)
          ? uniqueList((raw.routes as Array<string>).filter(Boolean).map((entry) => String(entry)))
          : request.routes;
    request.routes = routesFromPayload.length
      ? routesFromPayload.slice(0, CONFIG.maxRoutesPerRun)
      : request.routes;

    const viewportsPayload =
      typeof raw.viewports === 'string'
        ? parseViewportString(raw.viewports)
        : Array.isArray(raw.viewports)
          ? (raw.viewports as Array<Partial<ViewportSetting>>)
              .map((item) => ({
                name: String(item?.name || 'custom'),
                width: Number(item?.width) || 360,
                height: Number(item?.height) || 640,
              }))
          : request.viewports;
    request.viewports = viewportsPayload.length
      ? viewportsPayload.slice(0, 3)
      : request.viewports;

    if (typeof raw.includeJudge === 'boolean') request.includeJudge = raw.includeJudge;
    if (typeof raw.baseUrl === 'string') request.baseUrl = raw.baseUrl;
    if (typeof raw.sha === 'string') request.sha = raw.sha;
    if (typeof raw.branch === 'string') request.branch = raw.branch;
    if (typeof raw.actor === 'string') request.actor = raw.actor;
    if (typeof raw.idempotencyKey === 'string') request.idempotencyKey = raw.idempotencyKey;
    if (typeof raw.maxRoutes === 'number') request.maxRoutes = raw.maxRoutes;
    if (typeof raw.source === 'string' && (raw.source === 'github' || raw.source === 'api')) {
      request.source = raw.source;
    }

    const repo =
      typeof raw.repo === 'object' && raw.repo
        ? (raw.repo as { owner?: unknown; name?: unknown })
        : undefined;
    if (repo?.owner && repo?.name) {
      request.repo = { owner: String(repo.owner), name: String(repo.name) };
    }

    if (typeof raw.prNumber === 'number' && Number.isFinite(raw.prNumber)) {
      request.prNumber = raw.prNumber;
    }

    if (typeof raw.testMode === 'string' && (raw.testMode === 'agentic' || raw.testMode === 'scriptgen' || raw.testMode === 'screenshots-only')) {
      request.testMode = raw.testMode;
    }

    if (typeof raw.credentials === 'object' && raw.credentials && !Array.isArray(raw.credentials)) {
      request.credentials = raw.credentials as Record<string, string>;
    }

    if (typeof raw.maxTurns === 'number' && Number.isFinite(raw.maxTurns) && raw.maxTurns > 0) {
      request.maxTurns = raw.maxTurns;
    }

    request.sourceMetadata = {
      source: request.source,
      requestId: stableId(),
    };
  } catch (error) {
    validationErrors.push(`Failed to parse request payload: ${isHttpError(error) ? error.message : String(error)}`);
  }

  return { request, validationErrors };
}

export function parseViewportString(value: string): ViewportSetting[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((item) => {
      const [name, size] = item.split(':');
      const dims = size ? size.split('x') : [];
      return {
        name: name || 'custom',
        width: Number.parseInt(dims[0] ?? '360', 10),
        height: Number.parseInt(dims[1] ?? '640', 10),
      } as ViewportSetting;
    })
    .filter((viewport) => Number.isFinite(viewport.width) && Number.isFinite(viewport.height));
}

export function normalizeRequestForExecution(raw: RunRequest): RunRequest {
  const uniqueRoutes = uniqueList(raw.routes).slice(0, raw.maxRoutes ? raw.maxRoutes : CONFIG.maxRoutesPerRun);
  return {
    ...raw,
    routes: uniqueRoutes,
    viewports: raw.viewports.slice(0, 3),
    sourceMetadata: {
      ...raw.sourceMetadata,
      normalizedAt: new Date().toISOString(),
      normalizedBy: 'autobot',
    },
  };
}

export function statusMessageForState(state: JobStatus): string {
  const messages: Record<JobStatus, string> = {
    received: 'Request received and queued for processing',
    queued: 'Queued in background worker',
    running: 'Run is executing Playwright + visual checks',
    partial: 'Run completed with screenshot capture, but partial AI scoring errors occurred',
    failed: 'Run failed. Check report details for phase-level errors',
    succeeded: 'Run complete',
  };
  return messages[state] || 'Working';
}
