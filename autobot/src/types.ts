export type RunEnvironment = "preview" | "production" | "custom" | "managed";
export type RunMode = "minimal" | "smoke" | "full";
export type JobStatus =
  | "received"
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

export type Severity = "blocking" | "high" | "medium" | "low";

export interface ViewportSetting {
  name: string;
  width: number;
  height: number;
}

export interface RepoRef {
  owner: string;
  name: string;
}

export interface RouteFlowConfig {
  key: string;
  path: string;
  title?: string;
  ctaSelectors?: string[];
  secondarySelectors?: string[];
}

export interface RunRequest {
  environment: RunEnvironment;
  baseUrl?: string;
  routes: string[];
  mode: RunMode;
  viewports: ViewportSetting[];
  includeJudge: boolean;
  sha?: string;
  branch?: string;
  prNumber?: number;
  repo?: RepoRef;
  actor?: string;
  source: "api" | "github" | "web-trial";
  sourceMetadata: Record<string, unknown>;
  idempotencyKey?: string;
  maxRoutes?: number;
  testMode?: TestMode;
  credentials?: Record<string, string>;
  maxTurns?: number;
}

export type TestMode = 'agentic' | 'scriptgen' | 'screenshots-only';

export interface QueuedRun extends RunRequest {
  jobId: string;
  createdAt: string;
}

export interface QaFinding {
  severity: Severity;
  category: string;
  message: string;
  suggestion?: string;
  confidence?: number;
}

export interface PhaseJudgment {
  score: number;
  confidence: number;
  findings: QaFinding[];
  notes: string;
}

export interface PhaseRecord {
  routeKey: string;
  routePath: string;
  phase: string;
  viewport: string;
  screenshotPath: string;
  url: string;
  status: "captured" | "skipped" | "failed";
  error?: string;
  judge?: PhaseJudgment;
}

export interface RunTotals {
  score: number;
  blocking: number;
  high: number;
  medium: number;
  low: number;
  capturedPhases: number;
  failedPhases: number;
}

export interface RunReport {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  statusReason?: string;
  environment: RunEnvironment;
  baseUrl: string;
  mode: RunMode;
  routeCount: number;
  viewportCount: number;
  includeJudge: boolean;
  source: string;
  phases: PhaseRecord[];
  totals: RunTotals;
  config: Record<string, unknown>;
  aiTestReport?: AiTestReport;
}

export interface StatusRecord {
  id: string;
  status: JobStatus;
  progressMessage?: string;
  updatedAt: string;
  createdAt: string;
  reportPath?: string;
  error?: string;
}

export interface ManifestMatch {
  key: string;
  spec: RouteFlowConfig;
}

/* ------------------------------------------------------------------ */
/*  AI Test Report types                                               */
/* ------------------------------------------------------------------ */

export interface AiTestReport {
  status: 'pass' | 'fail' | 'partial' | 'error';
  flowsTotal: number;
  flowsPassed: number;
  flowsFailed: number;
  flowsSkipped: number;
  codeFaults: number;
  findings: AiTestFinding[];
  costUsd: number;
  durationMs: number;
  reportMd: string;
  screenshotKeys: string[];
  steps?: TrackedStep[];
  backtrackLog?: { from: string; to: string; reason: string }[];
}

export interface AiTestFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  message: string;
  flowId?: string;
  screenshot?: string;
  stepId?: string;
}

/* ------------------------------------------------------------------ */
/*  Flow-tracking types for agentic runner                             */
/* ------------------------------------------------------------------ */

export interface TrackedStep {
  id: string;
  name: string;
  url: string;
  actions: string[];
  checklist: { item: string; passed: boolean; notes?: string }[];
  observations: string;
  bugsFound: AiTestFinding[];
  screenshotKey?: string;
  isBacktrackPoint: boolean;
  backtrackExhausted: boolean;
}
