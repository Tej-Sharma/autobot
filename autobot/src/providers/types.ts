/** Provider-agnostic interface for per-user cloud environments.
 *  Implementations: flyProvider (now), hetznerProvider (future). */

export interface EnvironmentConfig {
  /** Unique name for this environment (e.g. "env-owner-repo") */
  name: string;
  /** Region to deploy in */
  region: string;
  /** Docker image for the machine */
  image: string;
  /** CPU count */
  cpus: number;
  /** RAM in megabytes */
  memoryMb: number;
  /** Persistent volume size in GB */
  volumeSizeGb: number;
  /** Environment variables to inject */
  env: Record<string, string>;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

export type EnvironmentStatus =
  | 'provisioning'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'destroyed';

export interface ProviderEnvironment {
  /** Provider-specific machine/VM ID */
  machineId: string;
  /** Provider-specific volume ID */
  volumeId: string;
  /** Region the environment is in */
  region: string;
  /** URL to reach the agent running inside this environment */
  agentUrl: string;
  /** Current status */
  status: EnvironmentStatus;
}

export interface EnvironmentProvider {
  /** Create a new environment (machine + volume). Returns in 'starting' or 'running' state. */
  createEnvironment(config: EnvironmentConfig): Promise<ProviderEnvironment>;

  /** Start a stopped environment. */
  startEnvironment(machineId: string): Promise<void>;

  /** Gracefully stop a running environment. Volume persists. */
  stopEnvironment(machineId: string): Promise<void>;

  /** Permanently destroy environment and its volume. */
  destroyEnvironment(machineId: string, volumeId: string): Promise<void>;

  /** Get the current status of an environment. */
  getStatus(machineId: string): Promise<EnvironmentStatus>;

  /** Wait until the machine reaches a target state (with timeout). */
  waitForState(
    machineId: string,
    targetState: EnvironmentStatus,
    timeoutMs?: number,
  ): Promise<void>;
}
