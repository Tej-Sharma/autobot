import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getRepoDir } from './cloneRunner';
import { DockerUpRequest, DockerUpResult } from './types';

function run(cmd: string, cwd: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    timeout: 300_000, // 5 min
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export async function dockerUp(req: DockerUpRequest): Promise<DockerUpResult> {
  const start = Date.now();
  const repoDir = getRepoDir();
  const composeFile = req.composeFile ?? 'docker-compose.yml';
  const composePath = path.join(repoDir, composeFile);

  try {
    if (!fs.existsSync(composePath)) {
      return {
        success: true,
        services: [],
        durationMs: Date.now() - start,
      };
    }

    // Start services in detached mode
    run(`docker compose -f ${composeFile} up -d --wait`, repoDir);

    // Get list of running services
    const output = run(`docker compose -f ${composeFile} ps --format json`, repoDir);
    const services: string[] = [];

    // docker compose ps --format json outputs one JSON object per line
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      try {
        const svc = JSON.parse(line);
        if (svc.Name || svc.Service) {
          services.push(svc.Service || svc.Name);
        }
      } catch {
        // Not JSON — might be a header line
      }
    }

    return {
      success: true,
      services,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      services: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'docker compose up failed',
    };
  }
}

export async function dockerDown(): Promise<void> {
  const repoDir = getRepoDir();
  const composePath = path.join(repoDir, 'docker-compose.yml');
  if (!fs.existsSync(composePath)) return;

  try {
    run('docker compose down --remove-orphans', repoDir);
  } catch {
    // best effort
  }
}
