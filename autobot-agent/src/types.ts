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
