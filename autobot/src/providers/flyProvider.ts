import {
  EnvironmentConfig,
  EnvironmentProvider,
  EnvironmentStatus,
  ProviderEnvironment,
} from './types';
import { CONFIG } from '../config';

/* ------------------------------------------------------------------ */
/*  Fly.io Machines API types                                          */
/* ------------------------------------------------------------------ */

interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip: string;
  config: {
    image: string;
    guest: { cpus: number; memory_mb: number; cpu_kind: string };
    env: Record<string, string>;
    services: FlyService[];
    mounts: FlyMount[];
  };
}

interface FlyService {
  protocol: string;
  internal_port: number;
  ports: Array<{ port: number; handlers: string[] }>;
}

interface FlyMount {
  volume: string;
  path: string;
  name?: string;
}

interface FlyVolume {
  id: string;
  name: string;
  size_gb: number;
  region: string;
  state: string;
  attached_machine_id: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const API_BASE = 'https://api.machines.dev/v1';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${CONFIG.flyApiToken}`,
    'Content-Type': 'application/json',
  };
}

function appUrl(path: string): string {
  return `${API_BASE}/apps/${CONFIG.flyAppName}${path}`;
}

function mapFlyState(flyState: string): EnvironmentStatus {
  switch (flyState) {
    case 'created':
    case 'starting':
      return 'starting';
    case 'started':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'stopped':
    case 'suspended':
      return 'stopped';
    case 'destroying':
    case 'destroyed':
      return 'destroyed';
    default:
      return 'failed';
  }
}

async function flyFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...headers(), ...init?.headers } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Fly API ${init?.method ?? 'GET'} ${url} → ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/*  Provider implementation                                            */
/* ------------------------------------------------------------------ */

export class FlyProvider implements EnvironmentProvider {
  /** Create a Fly volume + machine and return once the machine is started. */
  async createEnvironment(config: EnvironmentConfig): Promise<ProviderEnvironment> {
    // 1. Create volume
    const volume = await flyFetch<FlyVolume>(appUrl('/volumes'), {
      method: 'POST',
      body: JSON.stringify({
        name: config.name.replace(/[^a-z0-9_]/g, '_'),
        size_gb: config.volumeSizeGb,
        region: config.region,
        encrypted: true,
      }),
    });

    // 2. Create machine with the volume mounted
    const machine = await flyFetch<FlyMachine>(appUrl('/machines'), {
      method: 'POST',
      body: JSON.stringify({
        name: config.name,
        region: config.region,
        config: {
          image: config.image,
          guest: {
            cpu_kind: 'shared',
            cpus: config.cpus,
            memory_mb: config.memoryMb,
          },
          env: config.env,
          mounts: [
            {
              volume: volume.id,
              path: '/workspace',
            },
          ],
          services: [
            {
              protocol: 'tcp',
              internal_port: 8080,
              ports: [
                { port: 443, handlers: ['tls', 'http'] },
                { port: 80, handlers: ['http'] },
              ],
            },
          ],
          checks: {
            agent: {
              type: 'http',
              port: 8080,
              path: '/health',
              interval: '30s',
              timeout: '5s',
              grace_period: '30s',
            },
          },
          restart: {
            policy: 'on-failure',
            max_retries: 3,
          },
          metadata: config.metadata ?? {},
        },
      }),
    });

    // 3. Wait for machine to be running
    await this.waitForState(machine.id, 'running', 60_000);

    return {
      machineId: machine.id,
      volumeId: volume.id,
      region: machine.region,
      agentUrl: `https://${config.name}.fly.dev`,
      status: 'running',
    };
  }

  async startEnvironment(machineId: string): Promise<void> {
    await flyFetch<void>(appUrl(`/machines/${machineId}/start`), {
      method: 'POST',
    });
    await this.waitForState(machineId, 'running', 60_000);
  }

  async stopEnvironment(machineId: string): Promise<void> {
    await flyFetch<void>(appUrl(`/machines/${machineId}/stop`), {
      method: 'POST',
    });
    await this.waitForState(machineId, 'stopped', 30_000);
  }

  async destroyEnvironment(machineId: string, volumeId: string): Promise<void> {
    // Stop first if running, ignore errors (may already be stopped)
    try {
      await flyFetch<void>(appUrl(`/machines/${machineId}/stop`), { method: 'POST' });
      await this.waitForState(machineId, 'stopped', 30_000);
    } catch {
      // machine may already be stopped or destroyed
    }

    // Destroy machine
    await flyFetch<void>(appUrl(`/machines/${machineId}`), {
      method: 'DELETE',
      body: JSON.stringify({ force: true }),
    });

    // Destroy volume
    await flyFetch<void>(appUrl(`/volumes/${volumeId}`), {
      method: 'DELETE',
    });
  }

  async getStatus(machineId: string): Promise<EnvironmentStatus> {
    const machine = await flyFetch<FlyMachine>(appUrl(`/machines/${machineId}`));
    return mapFlyState(machine.state);
  }

  async waitForState(
    machineId: string,
    targetState: EnvironmentStatus,
    timeoutMs = 60_000,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.getStatus(machineId);
      if (status === targetState) return;
      if (status === 'failed' || status === 'destroyed') {
        throw new Error(`Machine ${machineId} reached terminal state: ${status}`);
      }
      await sleep(1_000);
    }
    throw new Error(
      `Timed out waiting for machine ${machineId} to reach state "${targetState}" after ${timeoutMs}ms`,
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Utility methods (not part of the interface, Fly-specific)        */
  /* ---------------------------------------------------------------- */

  /** List all machines in the app. */
  async listMachines(): Promise<FlyMachine[]> {
    return flyFetch<FlyMachine[]>(appUrl('/machines'));
  }

  /** List all volumes in the app. */
  async listVolumes(): Promise<FlyVolume[]> {
    return flyFetch<FlyVolume[]>(appUrl('/volumes'));
  }

  /** Get machine details by ID. */
  async getMachine(machineId: string): Promise<FlyMachine> {
    return flyFetch<FlyMachine>(appUrl(`/machines/${machineId}`));
  }
}
