import crypto from "node:crypto";
import express from "express";
import { CONFIG } from "./config";
import { enqueueRun } from "./queue";
import { normalizeRequestForExecution } from "./runnerConfig";
import { upsertRepoTokenMappings } from "./repoTokens";
import { getRepoConfig, setRepoConfig } from "./repoConfig";
import { RunMode, RunRequest, TestMode } from "./types";
import {
  ensureEnvironment,
  stopEnvironment,
  destroyEnvironment,
  getEnvironmentStatus,
  listUserEnvironments,
} from "./environmentManager";

export const REGISTERED_CONSOLE_PREFIX = "/api";

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
};

type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  permissions: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
};

type GithubWebhook = {
  id: number;
  active: boolean;
  events: string[];
  config: {
    url?: string;
    content_type?: string;
    secret?: string | null;
  };
};

type Session = {
  id: string;
  user: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string;
  };
  accessToken: string;
  createdAt: number;
};

type AuthState = {
  returnTo: string;
  issuedAt: number;
};

type SyncResult = {
  repo: string;
  status: "created" | "updated" | "already_configured" | "failed";
  message: string;
};

type RepoTokenSyncResult = {
  ok: boolean;
  updated: string[];
  failed: string[];
  error?: string;
};

type RunNowResult = {
  repo: string;
  status: "queued" | "failed";
  message: string;
  jobId?: string;
  statusUrl?: string;
};

const SESSION_COOKIE_NAME = "autobot_web_session";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || "604800000");
const AUTH_STATE_TTL_MS = Number(process.env.AUTH_STATE_TTL_MS || "900000");
const REQUIRED_SCOPE = "repo";
const HOOK_EVENTS = ["pull_request", "issue_comment"];

const CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const AUTOBOT_WEBHOOK_URL = process.env.AUTOBOT_WEBHOOK_URL;
const APP_BASE_URL = process.env.APP_BASE_URL;

const sessionStore = new Map<string, Session>();
const authStateStore = new Map<string, AuthState>();

const now = (): number => Date.now();

const parseCookies = (
  cookieHeader: string | undefined,
): Record<string, string> => {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return acc;
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rest.join("=") || "");
    acc[key] = value;
    return acc;
  }, {});
};

const buildUrl = (req: express.Request, value: string): string => {
  const base = APP_BASE_URL
    ? APP_BASE_URL.replace(/\/$/, "")
    : `${req.get("x-forwarded-proto")?.split(",")[0] || req.protocol || "https"}://${
        req.get("x-forwarded-host") || req.get("host")
      }`;
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
};

const normalizeReturnTo = (
  value: string | undefined,
  fallback: string,
): string => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = new URL(trimmed, "https://local.autobot");
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!normalized || !normalized.startsWith("/")) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
};

const setSessionCookie = (
  res: express.Response,
  sessionId: string,
  req: express.Request,
) => {
  const forwardedProto = req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const isSecure = req.secure || forwardedProto === "https";
  const expires = new Date(now() + SESSION_TTL_MS).toUTCString();
  const cookie = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expires}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.setHeader("Set-Cookie", cookie);
};

const clearSessionCookie = (res: express.Response) => {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT;`,
  );
};

const getSession = (req: express.Request): Session | null => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;

  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (now() - session.createdAt > SESSION_TTL_MS) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
};

const apiHeaders = (accessToken: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${accessToken}`,
  "User-Agent": "autobot",
});

const ghGet = async <T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...apiHeaders(accessToken),
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`GitHub API ${response.status}: ${raw}`);
  }

  if (response.status === 204) return null as T;

  return (await response.json()) as T;
};

const githubOauthError = (message: string, extra?: unknown): never => {
  throw new Error(message + (extra ? ` (${JSON.stringify(extra)})` : ""));
};

const cleanStores = () => {
  const expiry = now() - SESSION_TTL_MS;
  for (const [id, session] of sessionStore.entries()) {
    if (session.createdAt < expiry) {
      sessionStore.delete(id);
    }
  }

  const stateExpiry = now() - AUTH_STATE_TTL_MS;
  for (const [key, state] of authStateStore.entries()) {
    if (state.issuedAt < stateExpiry) {
      authStateStore.delete(key);
    }
  }
};

const normalizeUrl = (value: string) => value.trim().replace(/\/$/, "");

const registerRepoTokensWithAutobot = async (
  repos: string[],
  actor: string,
  accessToken: string,
): Promise<RepoTokenSyncResult> => {
  const result = await upsertRepoTokenMappings(repos, actor, accessToken);
  return {
    ok: result.failed.length === 0,
    updated: result.updated,
    failed: result.failed,
  };
};

const runNowMode = (value: unknown): RunMode => {
  if (typeof value !== "string") return "smoke";
  const lowered = value.toLowerCase();
  return lowered === "minimal" || lowered === "smoke" || lowered === "full"
    ? lowered
    : "smoke";
};

const postRunToAutobot = async (
  repo: string,
  defaultBranch: string,
  baseUrl: string,
  sessionUser: string,
  mode: RunMode,
  includeJudge: boolean,
  req: express.Request,
  testMode?: TestMode,
  credentials?: Record<string, string>,
) => {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repository name: ${repo}`);
  }

  const request = normalizeRequestForExecution({
    environment: "custom",
    baseUrl,
    routes: CONFIG.defaultRoutes,
    mode,
    viewports: CONFIG.defaultViewports,
    includeJudge,
    repo: {
      owner,
      name,
    },
    source: "api",
    sourceMetadata: {
      initiatedFrom: "autobot-console",
      repository: repo,
      actor: sessionUser,
    },
    branch: defaultBranch,
    actor: sessionUser,
    testMode,
    credentials,
  });

  const jobId = await enqueueRun(request);
  const base = `${req.get("x-forwarded-proto") || req.protocol}://${req.get("x-forwarded-host") || req.get("host")}`;
  return {
    ok: true,
    jobId,
    statusUrl: `${base}/api/qa/jobs/${jobId}`,
  };
};

export const registerConsoleRoutes = (
  app: express.Express,
  jsonBody: express.RequestHandler,
) => {
  setInterval(cleanStores, 5 * 60 * 1000);

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "autobot-web-console",
      ts: new Date().toISOString(),
    });
  });

  app.get("/api/session", (req, res) => {
    const session = getSession(req);

    if (!session) {
      res.json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      user: {
        id: session.user.id,
        login: session.user.login,
        name: session.user.name,
        avatarUrl: session.user.avatarUrl,
      },
    });
  });

  app.get("/api/auth/github", (req, res) => {
    if (
      !CLIENT_ID ||
      !CLIENT_SECRET ||
      !GITHUB_WEBHOOK_SECRET ||
      !AUTOBOT_WEBHOOK_URL
    ) {
      const missing = [
        !CLIENT_ID && "GITHUB_OAUTH_CLIENT_ID",
        !CLIENT_SECRET && "GITHUB_OAUTH_CLIENT_SECRET",
        !GITHUB_WEBHOOK_SECRET && "GITHUB_WEBHOOK_SECRET",
        !AUTOBOT_WEBHOOK_URL && "AUTOBOT_WEBHOOK_URL",
      ].filter(Boolean);

      res.status(500).json({
        error: "Server not configured for GitHub login. Missing values",
        missing,
      });
      return;
    }

    const state = crypto.randomUUID();
    const returnTo = normalizeReturnTo(
      typeof req.query.returnTo === "string" ? req.query.returnTo : undefined,
      "/dashboard",
    );

    authStateStore.set(state, {
      returnTo,
      issuedAt: now(),
    });

    const redirectUri = buildUrl(req, "/api/auth/github/callback");
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", REQUIRED_SCOPE);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("allow_signup", "true");

    res.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/github/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code || !state) {
      res.status(400).send("Invalid auth callback");
      return;
    }

    const stateData = authStateStore.get(state);
    if (!stateData) {
      res.status(400).send("Invalid or expired auth state");
      return;
    }

    if (now() - stateData.issuedAt > AUTH_STATE_TTL_MS) {
      authStateStore.delete(state);
      res.status(400).send("Auth state expired");
      return;
    }

    authStateStore.delete(state);

    try {
      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: buildUrl(req, "/api/auth/github/callback"),
            state,
          }),
        },
      );

      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload?.access_token) {
        githubOauthError("GitHub token exchange failed", tokenPayload);
      }

      const accessToken = tokenPayload.access_token as string;
      const user = await ghGet<GithubUser>(
        accessToken,
        "https://api.github.com/user",
      );
      const sessionId = crypto.randomUUID();

      const session: Session = {
        id: sessionId,
        user: {
          id: user.id,
          login: user.login,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
        accessToken,
        createdAt: now(),
      };

      sessionStore.set(sessionId, session);
      setSessionCookie(res, sessionId, req);
      res.redirect(stateData.returnTo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).send(message);
    }
  });

  app.post("/api/logout", (req, res) => {
    const session = getSession(req);
    if (session) {
      sessionStore.delete(session.id);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/repos", async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      let page = 1;
      const perPage = 100;
      const repositories: GithubRepo[] = [];

      while (page <= 10) {
        const url = `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`;
        const batch = await ghGet<GithubRepo[]>(session.accessToken, url);
        if (!batch.length) break;

        repositories.push(
          ...batch
            .filter((repo) => repo.permissions?.admin)
            .map((repo) => ({
              ...repo,
              full_name: repo.full_name,
            })),
        );

        if (batch.length < perPage) break;
        page += 1;
      }

      res.json({
        repositories: repositories.map((repo) => ({
          id: repo.id,
          fullName: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          private: repo.private,
          htmlUrl: repo.html_url,
          description: repo.description,
          defaultBranch: repo.default_branch,
          canAdministerHooks: true,
        })),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to fetch repos";
      res.status(502).json({ error: message });
    }
  });

  app.post("/api/webhooks/sync", jsonBody, async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (!AUTOBOT_WEBHOOK_URL) {
      res.status(500).json({ error: "AUTOBOT_WEBHOOK_URL is not configured" });
      return;
    }

    const repos = Array.isArray(req.body?.repos) ? req.body.repos : [];
    const cleanedRepos = repos
      .map((repo: string) => (typeof repo === "string" ? repo.trim() : ""))
      .filter((repo: string) => repo.includes("/"));

    if (cleanedRepos.length === 0) {
      res
        .status(400)
        .json({ error: "At least one repository must be selected" });
      return;
    }

    // Save per-repo test mode config
    const rawTestMode = typeof req.body?.testMode === 'string' ? req.body.testMode : 'screenshots-only';
    const testMode: TestMode = (rawTestMode === 'agentic' || rawTestMode === 'scriptgen')
      ? rawTestMode
      : 'screenshots-only';

    for (const repoName of cleanedRepos) {
      try {
        await setRepoConfig(repoName, { testMode, updatedBy: session.user.login });
      } catch (err) {
        console.error(`[consoleApi] failed to save config for ${repoName}:`, err);
      }
    }

    const outcomes: SyncResult[] = [];

    await Promise.all(
      cleanedRepos.map(async (fullName: string) => {
        try {
          const existingHooks = await ghGet<GithubWebhook[]>(
            session.accessToken,
            `https://api.github.com/repos/${fullName}/hooks?per_page=100`,
          );

          const existing = existingHooks.find(
            (hook) => hook.config?.url === AUTOBOT_WEBHOOK_URL,
          );

          const desiredConfig = {
            name: "web",
            active: true,
            events: HOOK_EVENTS,
            config: {
              url: AUTOBOT_WEBHOOK_URL,
              content_type: "json",
              secret: GITHUB_WEBHOOK_SECRET,
              insecure_ssl: "0",
            },
          };

          if (existing) {
            const needsUpdate =
              existing.active !== true ||
              !HOOK_EVENTS.every((event) => existing.events.includes(event)) ||
              !existing.config?.secret ||
              existing.config.url !== AUTOBOT_WEBHOOK_URL;

            if (needsUpdate) {
              await ghGet<unknown>(
                session.accessToken,
                `https://api.github.com/repos/${fullName}/hooks/${existing.id}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    active: desiredConfig.active,
                    events: desiredConfig.events,
                    config: desiredConfig.config,
                  }),
                },
              );
              outcomes.push({
                repo: fullName,
                status: "updated",
                message: "Existing hook updated.",
              });
            } else {
              outcomes.push({
                repo: fullName,
                status: "already_configured",
                message: "Hook already configured.",
              });
            }
            return;
          }

          await ghGet(
            session.accessToken,
            `https://api.github.com/repos/${fullName}/hooks`,
            {
              method: "POST",
              body: JSON.stringify(desiredConfig),
            },
          );

          outcomes.push({
            repo: fullName,
            status: "created",
            message: "Webhook created.",
          });
        } catch (error) {
          outcomes.push({
            repo: fullName,
            status: "failed",
            message:
              error instanceof Error ? error.message : "Failed to sync hook",
          });
        }
      }),
    );

    const failed = outcomes.filter((entry) => entry.status === "failed").length;
    let tokenSync: RepoTokenSyncResult = {
      ok: true,
      updated: [],
      failed: [],
    };

    try {
      tokenSync = await registerRepoTokensWithAutobot(
        cleanedRepos,
        session.user.login,
        session.accessToken,
      );
    } catch (error) {
      tokenSync = {
        ok: false,
        updated: [],
        failed: cleanedRepos,
        error:
          error instanceof Error
            ? error.message
            : "Failed to register repository token",
      };
    }

    res.json({
      ok: failed === 0 && tokenSync.ok,
      results: outcomes,
      tokenSync,
    });
  });

  app.post("/api/runs/default-branch", jsonBody, async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const rawRepos = Array.isArray(req.body?.repos) ? req.body.repos : [];
    const repos = rawRepos
      .map((repo: string) => (typeof repo === "string" ? repo.trim() : ""))
      .filter((repo: string) => repo.includes("/"));

    const runBaseUrl = normalizeUrl(
      typeof req.body?.baseUrl === "string" ? req.body.baseUrl : "",
    );
    const includeJudge = req.body?.includeJudge !== false;
    const mode = runNowMode(req.body?.mode);
    const testMode = typeof req.body?.testMode === 'string' ? req.body.testMode as TestMode : undefined;
    const rawCreds = typeof req.body?.credentials === 'string' ? req.body.credentials.trim() : '';
    const credentials: Record<string, string> = {};
    if (rawCreds) {
      for (const part of rawCreds.split(/[,;\/]/).map((s: string) => s.trim()).filter(Boolean)) {
        const sepIdx = part.indexOf(':');
        if (sepIdx > 0) {
          credentials[part.slice(0, sepIdx).trim()] = part.slice(sepIdx + 1).trim();
        }
      }
    }
    const hasCredentials = Object.keys(credentials).length > 0;

    if (!repos.length) {
      res
        .status(400)
        .json({ error: "At least one repository must be selected" });
      return;
    }

    if (!runBaseUrl) {
      res.status(400).json({ error: "A base URL is required to run now" });
      return;
    }

    let tokenSync: RepoTokenSyncResult = {
      ok: true,
      updated: [],
      failed: [],
    };

    try {
      tokenSync = await registerRepoTokensWithAutobot(
        repos,
        session.user.login,
        session.accessToken,
      );
    } catch (error) {
      tokenSync = {
        ok: false,
        updated: [],
        failed: repos,
        error:
          error instanceof Error
            ? error.message
            : "Failed to register repository token",
      };
    }

    const outcomes: RunNowResult[] = [];

    await Promise.all(
      repos.map(async (fullName: string) => {
        try {
          const repoMeta = await ghGet<{ default_branch: string }>(
            session.accessToken,
            `https://api.github.com/repos/${fullName}`,
          );

          const branch = repoMeta.default_branch || "main";
          const response = await postRunToAutobot(
            fullName,
            branch,
            runBaseUrl,
            session.user.login,
            mode,
            includeJudge,
            req,
            testMode,
            hasCredentials ? credentials : undefined,
          );

          outcomes.push({
            repo: fullName,
            status: "queued",
            message: "Run queued for default branch.",
            jobId: response?.jobId,
            statusUrl: response?.statusUrl,
          });
        } catch (error) {
          outcomes.push({
            repo: fullName,
            status: "failed",
            message:
              error instanceof Error ? error.message : "Failed to queue run",
          });
        }
      }),
    );

    const failed = outcomes.filter((entry) => entry.status === "failed").length;
    res.json({
      ok: failed === 0 && tokenSync.ok,
      results: outcomes,
      tokenSync,
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Environment management endpoints                                 */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /*  Per-repo config endpoints                                        */
  /* ---------------------------------------------------------------- */

  app.get("/api/repos/:owner/:repo/config", async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const repoFullName = `${req.params.owner}/${req.params.repo}`;
      const config = await getRepoConfig(repoFullName);
      res.json({ config: config ?? { testMode: "screenshots-only", enabled: true } });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to get repo config",
      });
    }
  });

  app.post("/api/repos/:owner/:repo/config", jsonBody, async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const repoFullName = `${req.params.owner}/${req.params.repo}`;
      const rawTestMode = typeof req.body?.testMode === "string" ? req.body.testMode : undefined;
      const testMode: TestMode | undefined =
        rawTestMode === "agentic" || rawTestMode === "scriptgen" || rawTestMode === "screenshots-only"
          ? rawTestMode
          : undefined;

      const config = await setRepoConfig(repoFullName, {
        testMode,
        updatedBy: session.user.login,
      });
      res.json({ ok: true, config });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to save repo config",
      });
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Environment management endpoints                                 */
  /* ---------------------------------------------------------------- */

  app.get("/api/environments", async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const envs = await listUserEnvironments(session.user.login);
      res.json({ environments: envs });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to list environments",
      });
    }
  });

  app.get("/api/environments/:owner/:repo", async (req, res) => {
    const session = getSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    try {
      const env = await getEnvironmentStatus({
        owner: req.params.owner,
        name: req.params.repo,
      });
      if (!env) {
        res.status(404).json({ error: "environment not found" });
        return;
      }
      res.json({ environment: env });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to get environment status",
      });
    }
  });

  app.post(
    "/api/environments/:owner/:repo/start",
    jsonBody,
    async (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      try {
        const env = await ensureEnvironment(
          { owner: req.params.owner, name: req.params.repo },
          session.user.login,
        );
        res.json({ ok: true, environment: env });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to start environment",
        });
      }
    },
  );

  app.post(
    "/api/environments/:owner/:repo/stop",
    jsonBody,
    async (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      try {
        await stopEnvironment({
          owner: req.params.owner,
          name: req.params.repo,
        });
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to stop environment",
        });
      }
    },
  );

  app.post(
    "/api/environments/:owner/:repo/destroy",
    jsonBody,
    async (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      try {
        await destroyEnvironment({
          owner: req.params.owner,
          name: req.params.repo,
        });
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to destroy environment",
        });
      }
    },
  );
};
