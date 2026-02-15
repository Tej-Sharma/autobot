import dotenv from 'dotenv';
import path from 'node:path';
import { RunMode, ViewportSetting } from './types';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseIntSafe = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseRoutes = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  return value
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean);
};

const parseViewports = (value: string | undefined, fallback: ViewportSetting[]): ViewportSetting[] => {
  if (!value) return fallback;
  const out: ViewportSetting[] = [];
  for (const raw of value.split(',')) {
    const segment = raw.trim();
    if (!segment) continue;
    const match = /^(\w+)\s*[:=]\s*(\d+)x(\d+)$/i.exec(segment);
    if (!match) continue;
    const [, name, width, height] = match;
    out.push({
      name,
      width: Number.parseInt(width, 10),
      height: Number.parseInt(height, 10),
    });
  }
  return out.length ? out : fallback;
};

const parseMode = (value: string | undefined, fallback: RunMode): RunMode => {
  if (!value) return fallback;
  if (value === 'minimal' || value === 'smoke' || value === 'full') return value;
  return fallback;
};

export const CONFIG = {
  nodeEnv: process.env.NODE_ENV ?? 'production',
  port: parseIntSafe(process.env.PORT, 4000),
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  queueName: process.env.QUEUE_NAME ?? 'autobot-qa',
  concurrency: parseIntSafe(process.env.WORKER_CONCURRENCY, 2),
  artifactRoot: process.env.ARTIFACT_ROOT ?? path.resolve(process.cwd(), 'artifacts'),
  artifactRetentionDays: parseIntSafe(process.env.ARTIFACT_RETENTION_DAYS, 14),
  jobStatusTtlSeconds: parseIntSafe(process.env.JOB_STATUS_TTL_SECONDS, 172800),

  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  githubToken: process.env.GITHUB_TOKEN,
  githubAllowedRepos: new Set(
    parseRoutes(process.env.GITHUB_ALLOWED_REPOS, []).map((entry) => entry.toLowerCase()),
  ),
  autobotApiToken: process.env.AUTOBOT_API_TOKEN,
  defaultRoutes: parseRoutes(process.env.DEFAULT_ROUTES, ['home', 'pricing', 'trial', 'features', 'downloads', 'blog', 'legal']),
  defaultViewports: parseViewports(
    process.env.DEFAULT_VIEWPORTS,
    [
      { name: 'desktop', width: 1280, height: 720 },
      { name: 'mobile', width: 390, height: 844 },
    ],
  ),
  defaultMode: parseMode(process.env.DEFAULT_MODE, 'smoke'),
  defaultJudge: parseBoolean(process.env.DEFAULT_JUDGE, true),
  maxRoutesPerRun: parseIntSafe(process.env.MAX_ROUTES_PER_RUN, 10),

  productionBaseUrl: process.env.BASE_URL_PRODUCTION,
  vercelToken: process.env.VERCEL_TOKEN,
  vercelProjectId: process.env.VERCEL_PROJECT_ID,

  autoRunOnPrOpen: parseBoolean(process.env.AUTO_RUN_PREVIEW_ON_PR_OPEN, true),
  autoRunOnPrSync: parseBoolean(process.env.AUTO_RUN_PREVIEW_ON_PR_SYNC, true),

  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openAiMaxTokens: parseIntSafe(process.env.OPENAI_MAX_TOKENS, 700),
  openAiRetries: parseIntSafe(process.env.OPENAI_RETRIES, 2),
  openAiTimeoutMs: parseIntSafe(process.env.OPENAI_TIMEOUT_MS, 30000),

  failOnBlocking: parseBoolean(process.env.QA_FAIL_ON_BLOCKING, true),
  failOnHighThreshold: parseIntSafe(process.env.QA_FAIL_ON_HIGH_THRESHOLD, 1),
  minimumScore: parseIntSafe(process.env.QA_MIN_SCORE, 78),

  requestTimeoutMs: parseIntSafe(process.env.QA_HTTP_TIMEOUT_MS, 120000),
};
