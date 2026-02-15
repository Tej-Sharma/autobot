export type RunEnvironment = 'preview' | 'production' | 'custom';
export type RunMode = 'minimal' | 'smoke' | 'full';
export type JobStatus = 'received' | 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';

export type Severity = 'blocking' | 'high' | 'medium' | 'low';

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
  source: 'api' | 'github';
  sourceMetadata: Record<string, unknown>;
  idempotencyKey?: string;
  maxRoutes?: number;
}

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
  status: 'captured' | 'skipped' | 'failed';
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
