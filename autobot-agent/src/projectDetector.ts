import fs from 'node:fs';
import path from 'node:path';
import { getRepoDir } from './cloneRunner';
import { ProjectConfig } from './types';

/**
 * Detect project configuration from the repo's files.
 * Reads package.json, lockfiles, and docker-compose to infer settings.
 */
export function detectProject(): ProjectConfig {
  const repoDir = getRepoDir();

  // Detect package manager from lockfile
  let packageManager: ProjectConfig['packageManager'] = 'npm';
  if (fs.existsSync(path.join(repoDir, 'pnpm-lock.yaml'))) {
    packageManager = 'pnpm';
  } else if (fs.existsSync(path.join(repoDir, 'yarn.lock'))) {
    packageManager = 'yarn';
  } else if (fs.existsSync(path.join(repoDir, 'bun.lockb'))) {
    packageManager = 'bun';
  }

  // Read package.json for scripts and port hints
  let startCommand = `${packageManager} run dev`;
  let devServerPort = 3000;

  const pkgJsonPath = path.join(repoDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};

      // Prefer dev script, fallback to start
      if (scripts.dev) {
        startCommand = `${packageManager} run dev`;
      } else if (scripts.start) {
        startCommand = `${packageManager} run start`;
      }

      // Try to detect port from scripts
      const devScript = scripts.dev ?? scripts.start ?? '';
      const portMatch = /--port[= ](\d+)|-p[= ]?(\d+)|PORT=(\d+)/.exec(devScript);
      if (portMatch) {
        const portStr = portMatch[1] ?? portMatch[2] ?? portMatch[3];
        const parsed = parseInt(portStr, 10);
        if (parsed > 0 && parsed < 65536) {
          devServerPort = parsed;
        }
      }

      // Framework-specific port defaults
      if (pkg.dependencies?.next || pkg.devDependencies?.next) {
        devServerPort = 3000;
      } else if (pkg.dependencies?.nuxt || pkg.devDependencies?.nuxt) {
        devServerPort = 3000;
      } else if (pkg.dependencies?.vite || pkg.devDependencies?.vite) {
        devServerPort = 5173;
      } else if (pkg.dependencies?.['@angular/core'] || pkg.devDependencies?.['@angular/core']) {
        devServerPort = 4200;
      }
    } catch {
      // Invalid package.json — use defaults
    }
  }

  // Check for docker-compose
  let hasDockerCompose = false;
  let dockerComposeFile: string | undefined;
  for (const candidate of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    if (fs.existsSync(path.join(repoDir, candidate))) {
      hasDockerCompose = true;
      dockerComposeFile = candidate;
      break;
    }
  }

  return {
    packageManager,
    startCommand,
    devServerPort,
    hasDockerCompose,
    dockerComposeFile,
  };
}
