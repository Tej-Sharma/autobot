import fs from 'node:fs';
import path from 'node:path';
import { getRepoDir } from './cloneRunner';
import { isDevServerRunning, getDevServerPort } from './devServer';
import { HealthStatus } from './types';

const startTime = Date.now();

export function getHealth(): HealthStatus {
  const repoDir = getRepoDir();

  return {
    agent: 'ok',
    repoCloned: fs.existsSync(path.join(repoDir, '.git')),
    nodeModulesReady: fs.existsSync(path.join(repoDir, 'node_modules')),
    devServerRunning: isDevServerRunning(),
    devServerPort: getDevServerPort(),
    dockerServicesRunning: false, // TODO: check docker compose ps
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
}
