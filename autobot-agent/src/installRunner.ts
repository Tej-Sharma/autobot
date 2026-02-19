import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getRepoDir } from './cloneRunner';
import { InstallRequest, InstallResult } from './types';

const WORKSPACE = '/workspace';
const HASH_FILE = path.join(WORKSPACE, '.autobot', 'lockfile-hash');

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function findLockfile(repoDir: string): { file: string; manager: 'npm' | 'yarn' | 'pnpm' | 'bun' } | null {
  const candidates: Array<{ file: string; manager: 'npm' | 'yarn' | 'pnpm' | 'bun' }> = [
    { file: 'package-lock.json', manager: 'npm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'bun.lockb', manager: 'bun' },
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(repoDir, candidate.file))) {
      return candidate;
    }
  }
  return null;
}

function getInstallCommand(manager: 'npm' | 'yarn' | 'pnpm' | 'bun'): string {
  switch (manager) {
    case 'npm': return 'npm ci --prefer-offline';
    case 'yarn': return 'yarn install --frozen-lockfile';
    case 'pnpm': return 'pnpm install --frozen-lockfile';
    case 'bun': return 'bun install --frozen-lockfile';
  }
}

export async function installDeps(req: InstallRequest): Promise<InstallResult> {
  const start = Date.now();
  const repoDir = getRepoDir();

  try {
    if (!fs.existsSync(path.join(repoDir, 'package.json'))) {
      return {
        success: true,
        skipped: true,
        durationMs: Date.now() - start,
      };
    }

    const lockInfo = findLockfile(repoDir);
    const manager = req.packageManager ?? lockInfo?.manager ?? 'npm';

    // Check lockfile hash to see if we can skip install
    if (lockInfo) {
      const lockfilePath = path.join(repoDir, lockInfo.file);
      const currentHash = hashFile(lockfilePath);

      fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });

      if (fs.existsSync(HASH_FILE)) {
        const storedHash = fs.readFileSync(HASH_FILE, 'utf-8').trim();
        if (storedHash === currentHash && fs.existsSync(path.join(repoDir, 'node_modules'))) {
          return {
            success: true,
            skipped: true,
            durationMs: Date.now() - start,
          };
        }
      }

      // Run install
      const cmd = getInstallCommand(manager);
      execSync(cmd, {
        cwd: repoDir,
        encoding: 'utf-8',
        timeout: 600_000, // 10 minute timeout
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_cache: path.join(WORKSPACE, '.npm-cache') },
      });

      // Store new hash
      fs.writeFileSync(HASH_FILE, currentHash, 'utf-8');
    } else {
      // No lockfile — run plain install
      execSync(`${manager} install`, {
        cwd: repoDir,
        encoding: 'utf-8',
        timeout: 600_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, npm_config_cache: path.join(WORKSPACE, '.npm-cache') },
      });
    }

    return {
      success: true,
      skipped: false,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      skipped: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'install failed',
    };
  }
}
