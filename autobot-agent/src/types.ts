/* ------------------------------------------------------------------ */
/*  Shared types for the autobot-agent                                 */
/* ------------------------------------------------------------------ */

export interface CloneRequest {
  repoUrl: string;
  branch: string;
  sha?: string;
  accessToken?: string;
}

export interface CloneResult {
  success: boolean;
  cloned: boolean;      // true = fresh clone, false = fetch+checkout
  sha: string;
  durationMs: number;
  error?: string;
}

export interface InstallRequest {
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

export interface InstallResult {
  success: boolean;
  skipped: boolean;     // true = lockfile hash matched, no install needed
  durationMs: number;
  packageCount?: number;
  error?: string;
}

export interface DockerUpRequest {
  composeFile?: string; // defaults to docker-compose.yml
}

export interface DockerUpResult {
  success: boolean;
  services: string[];
  durationMs: number;
  error?: string;
}

export interface StartRequest {
  command?: string;     // override detected start command
  port?: number;        // override detected port
}

export interface StartResult {
  success: boolean;
  port: number;
  url: string;
  pid: number;
  durationMs: number;
  error?: string;
}

export interface ScreenshotRequest {
  routes: Array<{
    key: string;
    path: string;
    ctaSelectors?: string[];
  }>;
  viewports: Array<{
    name: string;
    width: number;
    height: number;
  }>;
  mode: 'minimal' | 'smoke' | 'full';
  baseUrl?: string;     // override — defaults to http://localhost:{devServerPort}
}

export interface ScreenshotPhase {
  routeKey: string;
  routePath: string;
  phase: string;
  viewport: string;
  screenshotBase64: string;
  url: string;
  status: 'captured' | 'skipped' | 'failed';
  error?: string;
}

export interface ScreenshotResult {
  success: boolean;
  phases: ScreenshotPhase[];
  durationMs: number;
  error?: string;
}

export interface ProjectConfig {
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  startCommand: string;
  devServerPort: number;
  hasDockerCompose: boolean;
  dockerComposeFile?: string;
}

export interface HealthStatus {
  agent: 'ok' | 'error';
  repoCloned: boolean;
  nodeModulesReady: boolean;
  devServerRunning: boolean;
  devServerPort: number | null;
  dockerServicesRunning: boolean;
  uptime: number;
}

/* ------------------------------------------------------------------ */
/*  AI Test Runner types                                               */
/* ------------------------------------------------------------------ */

export type AiTestMode = 'agentic' | 'scriptgen';

export interface AiTestRequest {
  mode: AiTestMode;
  baseUrl?: string;
  budget?: number;
  credentials?: Record<string, string>;
  description?: string;
  forceAnalysis?: boolean;
}

export interface AiTestResult {
  success: boolean;
  report: AiTestReport | null;
  screenshots: Record<string, string>;  // filename -> base64
  error?: string;
  durationMs: number;
}

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
}

export interface AiTestFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  message: string;
  flowId?: string;
  screenshot?: string;
}

/* ------------------------------------------------------------------ */
/*  Agent Loop types                                                   */
/* ------------------------------------------------------------------ */

export interface AgentConfig {
  anthropicApiKey: string;
  userApiKey: string;          // csk_ key for MCP server auth
  mcpServerUrl?: string;       // default: https://fastfind.app
  model?: string;              // default: claude-sonnet-4-20250514
  maxBudgetUsd?: number;       // default: 5
  systemPrompt?: string;       // custom system prompt additions
  userTimezone?: string;       // default: UTC
}

export type AgentEventType =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'done'
  | 'error';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, any>;
}

export interface AgentTaskAssignment {
  taskId: string;
  taskType: string;
  title: string;
  description: string;
  parameters: Record<string, any>;
  config: Record<string, any>;
}
