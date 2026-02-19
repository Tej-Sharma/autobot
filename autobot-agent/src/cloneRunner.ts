import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CloneRequest, CloneResult } from './types';

const WORKSPACE = '/workspace';
const REPO_DIR = path.join(WORKSPACE, 'repo');

export function getRepoDir(): string {
  return REPO_DIR;
}

function buildCloneUrl(repoUrl: string, accessToken?: string): string {
  if (!accessToken) return repoUrl;
  // https://github.com/owner/repo.git → https://x-access-token:TOKEN@github.com/owner/repo.git
  const url = new URL(repoUrl);
  url.username = 'x-access-token';
  url.password = accessToken;
  return url.toString();
}

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    timeout: 120_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export async function cloneRepo(req: CloneRequest): Promise<CloneResult> {
  const start = Date.now();
  const authUrl = buildCloneUrl(req.repoUrl, req.accessToken);

  try {
    const alreadyCloned = fs.existsSync(path.join(REPO_DIR, '.git'));

    if (alreadyCloned) {
      // Fetch and checkout
      run('git fetch origin', REPO_DIR);
      run(`git checkout ${req.branch}`, REPO_DIR);
      run(`git reset --hard origin/${req.branch}`, REPO_DIR);
      if (req.sha) {
        run(`git checkout ${req.sha}`, REPO_DIR);
      }
      const sha = run('git rev-parse HEAD', REPO_DIR);
      return {
        success: true,
        cloned: false,
        sha,
        durationMs: Date.now() - start,
      };
    }

    // Fresh clone
    fs.mkdirSync(REPO_DIR, { recursive: true });
    run(`git clone --depth=50 --branch ${req.branch} ${authUrl} ${REPO_DIR}`);
    if (req.sha) {
      run(`git fetch origin ${req.sha}`, REPO_DIR);
      run(`git checkout ${req.sha}`, REPO_DIR);
    }
    const sha = run('git rev-parse HEAD', REPO_DIR);
    return {
      success: true,
      cloned: true,
      sha,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      cloned: false,
      sha: '',
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'clone failed',
    };
  }
}
