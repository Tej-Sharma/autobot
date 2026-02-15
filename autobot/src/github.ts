import { CONFIG } from './config';
import { Octokit } from '@octokit/rest';
import { parseCommaSeparated } from './utils';
import { parseRunPayload, normalizeRequestForExecution } from './runnerConfig';
import { RunRequest } from './types';
import { getRepoTokenForActor } from './repoTokens';

const fallbackOctokit = CONFIG.githubToken ? new Octokit({ auth: CONFIG.githubToken }) : null;
const tokenizedOctokit = (token?: string): Octokit | null => (token ? new Octokit({ auth: token }) : null);

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

function repoIdentifier(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

async function fetchPullMetadata(
  owner: string,
  repo: string,
  pullNumber: number,
  preferredActor?: string,
): Promise<{ branch?: string; sha?: string } | null> {
  const actorToken = preferredActor ? await getRepoTokenForActor(repoIdentifier(owner, repo), preferredActor) : undefined;
  const clients = [tokenizedOctokit(actorToken), fallbackOctokit];

  for (const client of clients) {
    if (!client) continue;
    try {
      const response = await client.rest.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return {
        branch: response.data.head.ref,
        sha: response.data.head.sha,
      };
    } catch (error) {
      // Try fallback on failure.
      if (client === fallbackOctokit) {
        console.warn('[github] could not enrich pull request metadata', error);
      }
    }
  }

  return null;
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
  const actor = payload.sender?.login;

  const existingMetadata = request.sourceMetadata || {};
  const requestBranch = request.branch;
  const requestSha = request.sha;
  let branch = requestBranch;
  let sha = requestSha;

  if (issueIsPr && (!branch || !sha) && incomingPull) {
    const pullInfo = await fetchPullMetadata(owner, name, incomingPull, actor);
    if (!branch) branch = pullInfo?.branch;
    if (!sha) sha = pullInfo?.sha;
  } else if (!branch && payload.pull_request?.head?.ref) {
    branch = payload.pull_request.head.ref;
  } else if (!sha && payload.pull_request?.head?.sha) {
    sha = payload.pull_request.head?.sha;
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
      actor,
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
    actor,
  };

  if (!issueIsPr && result.environment === 'preview') {
    return null;
  }

  return result;
}

export async function postGithubComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await postGithubCommentForActor(owner, repo, issueNumber, body);
}

export async function postGithubCommentForActor(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
  actor?: string,
): Promise<void> {
  const actorToken = actor ? await getRepoTokenForActor(repoIdentifier(owner, repo), actor) : undefined;
  const clients = [tokenizedOctokit(actorToken), fallbackOctokit];
  const attempted: string[] = [];
  let lastError: unknown;

  for (const client of clients) {
    if (!client) continue;
    attempted.push(client === fallbackOctokit ? 'fallback-token' : `actor:${actor ?? 'unspecified'}`);
    try {
      await client.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body,
      });
      return;
    } catch (error) {
      lastError = error;
      if (client === fallbackOctokit) {
        break;
      }
    }
  }

  if (attempted.length === 0) {
    throw new Error(`No GitHub credentials available for ${owner}/${repo}. Connect repo token first.`);
  }

  if (lastError) {
    const tokenLabel = attempted.at(-1) ?? 'token';
    if (lastError instanceof Error) {
      throw new Error(`GitHub comment failed using ${tokenLabel}: ${lastError.message}`);
    }
    throw lastError;
  }
}
