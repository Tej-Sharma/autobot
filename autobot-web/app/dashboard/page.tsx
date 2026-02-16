"use client";

import { useEffect, useMemo, useState } from "react";

type SessionPayload = {
  authenticated: boolean;
  user?: {
    id: number;
    login: string;
    name: string | null;
    avatarUrl: string;
  };
};

type Repo = {
  id: number;
  fullName: string;
  description: string | null;
  private: boolean;
};

type StatusLine = {
  text: string;
  statusUrl?: string;
};

type ReposPayload = {
  repositories: Repo[];
};

type WebhookPayload = {
  results: Array<{
    repo: string;
    status: string;
    message: string;
  }>;
  tokenSync?: {
    ok: boolean;
    failed?: string[];
  };
};

type RunPayload = {
  results: Array<{
    repo: string;
    status: string;
    message: string;
    statusUrl?: string;
  }>;
  tokenSync?: {
    ok: boolean;
    failed?: string[];
  };
};

const formatState = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const payload = (await response
    .json()
    .catch(() => ({ error: "Invalid JSON response" }))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const error =
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(error);
  }

  return payload as T;
}

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<SessionPayload["user"]>(undefined);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [baseUrl, setBaseUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusLines, setStatusLines] = useState<StatusLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedRepos = useMemo(
    () => Object.keys(selected).filter((name) => selected[name]),
    [selected],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoadError(null);
        const session = await api<SessionPayload>("/api/session");
        if (!session.authenticated || !session.user) {
          window.location.replace("/");
          return;
        }
        const repoPayload = await api<ReposPayload>("/api/repos");
        if (cancelled) return;
        setUser(session.user);
        setRepos(repoPayload.repositories || []);
      } catch (error) {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Failed to load dashboard";
        setLoadError(message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleRepo = (repoFullName: string) => {
    setSelected((previous) => ({
      ...previous,
      [repoFullName]: !previous[repoFullName],
    }));
  };

  const requireSelectedRepos = (): string[] => {
    if (!selectedRepos.length) {
      setStatusLines([{ text: "Select at least one repository first." }]);
      return [];
    }
    return selectedRepos;
  };

  const syncWebhooks = async () => {
    const reposToSync = requireSelectedRepos();
    if (!reposToSync.length) return;

    try {
      setSyncing(true);
      setStatusLines([{ text: "Syncing webhooks..." }]);
      const result = await api<WebhookPayload>("/api/webhooks/sync", {
        method: "POST",
        body: JSON.stringify({ repos: reposToSync }),
      });

      const lines: StatusLine[] = result.results.map((entry) => ({
        text: `${entry.repo}: ${formatState(entry.status)} - ${entry.message}`,
      }));

      if (result.tokenSync && !result.tokenSync.ok) {
        const failed = (result.tokenSync.failed || []).join(", ");
        lines.push({
          text: `Token sync failed${failed ? ` for ${failed}` : ""}; fallback token may be used.`,
        });
      }

      setStatusLines(lines);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync webhooks";
      setStatusLines([{ text: message }]);
    } finally {
      setSyncing(false);
    }
  };

  const runNow = async () => {
    const reposToRun = requireSelectedRepos();
    if (!reposToRun.length) return;

    const normalizedBaseUrl = baseUrl.trim();
    if (!normalizedBaseUrl) {
      setStatusLines([{ text: "Enter a deployment URL before running." }]);
      return;
    }

    try {
      setRunning(true);
      setStatusLines([{ text: "Queueing runs..." }]);
      const result = await api<RunPayload>("/api/runs/default-branch", {
        method: "POST",
        body: JSON.stringify({
          repos: reposToRun,
          baseUrl: normalizedBaseUrl,
          mode: "smoke",
          includeJudge: true,
        }),
      });

      const lines: StatusLine[] = result.results.map((entry) => ({
        text: `${entry.repo}: ${formatState(entry.status)} - ${entry.message}`,
        statusUrl: entry.statusUrl,
      }));

      if (result.tokenSync && !result.tokenSync.ok) {
        const failed = (result.tokenSync.failed || []).join(", ");
        lines.push({
          text: `Token sync failed${failed ? ` for ${failed}` : ""}; fallback token may be used.`,
        });
      }

      setStatusLines(lines);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run";
      setStatusLines([{ text: message }]);
    } finally {
      setRunning(false);
    }
  };

  const logout = async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } catch {
      // Redirect to landing even if logout API fails.
    }
    window.location.replace("/");
  };

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">AutoBot Dashboard</div>
        <div className="links">
          <a
            className="muted"
            href="https://x.com/taayjuss"
            target="_blank"
            rel="noopener noreferrer"
          >
            X
          </a>
          <a
            className="muted"
            href="https://github.com/Tej-Sharma/autobot"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <button className="button" onClick={logout}>
            Sign Out
          </button>
        </div>
      </header>

      <section className="panel grid">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, letterSpacing: "-0.02em" }}>
              Connected Account
            </h1>
            <p className="muted" style={{ marginTop: 8 }}>
              Pick repos, sync webhooks, and run QA now.
            </p>
          </div>
          {user ? <span className="badge">@{user.login}</span> : null}
        </div>

        {isLoading ? <div className="empty">Loading dashboard...</div> : null}
        {loadError ? <div className="empty error">{loadError}</div> : null}

        {!isLoading && !loadError ? (
          <>
            <div className="grid">
              <label htmlFor="baseUrl" className="muted">
                Run now target URL
              </label>
              <input
                id="baseUrl"
                className="input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://your-app.example.com"
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="button primary"
                onClick={syncWebhooks}
                disabled={syncing}
              >
                {syncing ? "Syncing..." : "Enable Webhooks"}
              </button>
              <button
                className="button"
                onClick={runNow}
                disabled={running}
              >
                {running ? "Queueing..." : "Run Now"}
              </button>
            </div>

            {repos.length ? (
              <div className="repo-list">
                {repos.map((repo) => (
                  <label className="repo-row" key={repo.id}>
                    <input
                      type="checkbox"
                      checked={!!selected[repo.fullName]}
                      onChange={() => toggleRepo(repo.fullName)}
                    />
                    <span>
                      <span className="repo-name">{repo.fullName}</span>
                      <span className="muted" style={{ display: "block" }}>
                        {repo.description || "No description"}
                      </span>
                    </span>
                    <span className="badge">{repo.private ? "Private" : "Public"}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="empty">
                No repositories with webhook admin access were found.
              </div>
            )}

            {statusLines.length ? (
              <div className="status-box">
                {statusLines.map((line, index) => (
                  <p key={`${line.text}-${index}`} className="status-line">
                    {line.text}
                    {line.statusUrl ? (
                      <>
                        {" "}
                        <a href={line.statusUrl} target="_blank" rel="noreferrer">
                          status
                        </a>
                      </>
                    ) : null}
                  </p>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      <footer className="footer">
        <span>© 2026 Constella App, Inc.</span>
        <span className="muted">
          Auth and repo APIs served from <code>autobot</code> backend.
        </span>
      </footer>
    </main>
  );
}
