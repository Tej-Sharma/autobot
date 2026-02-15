import { CONFIG } from './config';
import { Octokit } from '@octokit/rest';
import { parseCommaSeparated } from './utils';
import { parseRunPayload, normalizeRequestForExecution } from './runnerConfig';
import { RunRequest } from './types';

const octokit = CONFIG.githubToken ? new Octokit({ auth: CONFIG.githubToken }) : null;

export function isRepoAllowed(owner: string, repo: string): boolean {
  if (CONFIG.githubAllowedRepos.size === 0) return true;
  const key = `${owner}/${repo}`.toLowerCase();
  return CONFIG.githubAllowedRepos.has(key);
}

export function parseQaCommandComment(commentBody: string): RunRequest | null {
  const commandMatch = /\/qa\s+run\b([^\n\r]*)?/i.exec(commentBody);
  if (!commandMatch) return null;

  const args = commandMatch[1] ?? '';
  const tokens = args
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const payload: Record<string, unknown> = {};
  for (const token of tokens) {
    const kv = token.match(/^(\w+)=(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (!key || value === undefined) continue;

    if (key.toLowerCase() === 'routes') {
      payload.routes = parseCommaSeparated(value);
      continue;
    }

    if (key.toLowerCase() === 'viewport' || key.toLowerCase() === 'viewports') {
      payload.viewports = value;
      continue;
    }

    if (key.toLowerCase() === 'mode') {
      payload.mode = value.toLowerCase();
      continue;
    }

    if (key.toLowerCase() === 'env' || key.toLowerCase() === 'environment') {
      payload.environment = value.toLowerCase();
      continue;
    }

    if (key.toLowerCase() === 'baseurl' || key.toLowerCase() === 'url') {
      payload.baseUrl = value;
      continue;
    }

    if (key.toLowerCase() === 'sha') {
      payload.sha = value;
      continue;
    }

    if (key.toLowerCase() === 'branch') {
      payload.branch = value;
      continue;
    }

    if (key.toLowerCase() === 'idempotency') {
      payload.idempotencyKey = value;
      continue;
    }

    if (key.toLowerCase() === 'judge') {
      payload.includeJudge = value.toLowerCase() !== 'false';
      continue;
    }
  }

  if (tokens.includes('nojudge')) payload.includeJudge = false;

  const parsed = parseRunPayload(payload).request;
  const normalized = normalizeRequestForExecution(parsed);

  return normalized;
}

async function fetchPullMetadata(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<{ branch?: string; sha?: string } | null> {
  if (!octokit) return null;
  try {
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return {
      branch: response.data.head.ref,
      sha: response.data.head.sha,
    };
  } catch (error) {
    console.warn('[github] could not enrich pull request metadata', error);
    return null;
  }
}

export async function parseWebhookRun(payload: any): Promise<RunRequest | null> {
  if (!payload?.comment?.body) return null;
  const repo = payload.repository;
  const owner = repo?.owner?.login;
  const name = repo?.name;
  if (!owner || !name) return null;

  if (!isRepoAllowed(owner, name)) {
    return null;
  }

  const request = parseQaCommandComment(payload.comment.body);
  if (!request) return null;

  const incomingPull = payload.issue?.number ? Number(payload.issue?.number) : undefined;
  const issueIsPr = !!payload.issue?.pull_request;

  const existingMetadata = request.sourceMetadata || {};
  const requestBranch = request.branch;
  const requestSha = request.sha;
  let branch = requestBranch;
  let sha = requestSha;

  if (issueIsPr && (!branch || !sha) && incomingPull && octokit) {
    const pullInfo = await fetchPullMetadata(owner, name, incomingPull);
    if (!branch) branch = pullInfo?.branch;
    if (!sha) sha = pullInfo?.sha;
  } else if (!branch && payload.pull_request?.head?.ref) {
    branch = payload.pull_request.head.ref;
  } else if (!sha && payload.pull_request?.head?.sha) {
    sha = payload.pull_request.head.sha;
  }

  if (!request.baseUrl) {
    if (payload.pull_request?.head?.ref) {
      branch = branch || payload.pull_request.head.ref;
    }
    if (payload.pull_request?.head?.sha) {
      sha = sha || payload.pull_request.head.sha;
    }
  }

  const result: RunRequest = {
    ...request,
    source: 'github',
    sourceMetadata: {
      commentId: payload.comment?.id,
      actor: payload.sender?.login,
      installationId: payload.installation?.id,
      requestType: 'issue_comment',
      repository: `${owner}/${name}`,
      issueUrl: payload.issue?.url,
      action: payload.action,
    },
    ...existingMetadata,
    branch,
    sha,
    repo: owner && name ? { owner, name } : undefined,
    prNumber: payload.issue?.number,
    actor: payload.sender?.login,
  };

  if (!issueIsPr && result.environment === 'preview') {
    return null;
  }

  return result;
}

export async function postGithubComment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  if (!octokit) {
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}
