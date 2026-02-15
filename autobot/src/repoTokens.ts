import { redis } from './redis';

export interface RepoTokenEntry {
  login: string;
  accessToken: string;
  createdAt: number;
  updatedAt: number;
}

const REPO_TOKEN_PREFIX = 'autobot:repo-tokens:';
const tokenTTLSeconds = 60 * 60 * 24 * 90;
const MAX_TOKENS_PER_REPO = 5;

function normalizeRepoKey(repo: string): string {
  const lowered = repo.trim().toLowerCase();
  if (!lowered.includes('/')) {
    throw new Error('Repository must be in owner/repo format');
  }
  return lowered;
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

function repoTokenKey(repo: string): string {
  return `${REPO_TOKEN_PREFIX}${normalizeRepoKey(repo)}`;
}

function parseTokenEntries(raw: string | null): RepoTokenEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RepoTokenEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        !!entry &&
        typeof entry.login === 'string' &&
        typeof entry.accessToken === 'string' &&
        typeof entry.createdAt === 'number' &&
        typeof entry.updatedAt === 'number',
    );
  } catch {
    return [];
  }
}

export async function upsertRepoTokenMappings(
  repos: string[],
  login: string,
  accessToken: string,
): Promise<{ updated: string[]; failed: string[] }> {
  const updated: string[] = [];
  const failed: string[] = [];
  const now = Date.now();
  const normalizedLogin = normalizeLogin(login);

  await Promise.all(
    repos.map(async (repo) => {
      try {
        const key = repoTokenKey(repo);
        const raw = await redis.get(key);
        const entries = parseTokenEntries(raw);
        const filtered = entries.filter((entry) => normalizeLogin(entry.login) !== normalizedLogin);
        filtered.unshift({
          login: normalizedLogin,
          accessToken,
          createdAt: entries.find((entry) => normalizeLogin(entry.login) === normalizedLogin)?.createdAt ?? now,
          updatedAt: now,
        });

        const sliced = filtered.slice(0, MAX_TOKENS_PER_REPO);
        await redis.set(key, JSON.stringify(sliced), 'EX', tokenTTLSeconds);
        updated.push(repo);
      } catch {
        failed.push(repo);
      }
    }),
  );

  return { updated, failed };
}

export async function getRepoTokenForActor(repo: string, preferredActor?: string): Promise<string | undefined> {
  const key = repoTokenKey(repo);
  const raw = await redis.get(key);
  const entries = parseTokenEntries(raw);
  if (entries.length === 0) return undefined;
  if (preferredActor) {
    const preferred = entries.find(
      (entry) => normalizeLogin(entry.login) === normalizeLogin(preferredActor),
    );
    if (preferred) return preferred.accessToken;
  }
  return entries[0]?.accessToken;
}
