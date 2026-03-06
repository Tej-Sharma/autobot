"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardNavbar } from "../../components/DashboardNavbar";
import { Footer } from "../../components/Footer";

interface UserInfo {
  login: string;
  name: string;
  avatarUrl: string;
}

interface Repo {
  fullName: string;
  description: string | null;
  private: boolean;
}

interface SyncResultEntry {
  repo: string;
  status: string;
  message: string;
  jobId?: string;
  statusUrl?: string;
}

interface TokenSync {
  ok: boolean;
  failed?: string[];
}

async function api<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response
    .json()
    .catch(() => ({ error: "Invalid JSON response" }));
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string }).error ||
        `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposEmpty, setReposEmpty] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [testMode, setTestMode] = useState<"screenshots-only" | "scriptgen" | "agentic">("screenshots-only");
  const [runBaseUrl, setRunBaseUrl] = useState("");

  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMessageType, setSyncMessageType] = useState<"info" | "warning">(
    "info",
  );
  const [syncing, setSyncing] = useState(false);
  const [running, setRunning] = useState(false);

  const loadDashboardData = useCallback(async () => {
    try {
      const session = await api<{
        authenticated: boolean;
        user: UserInfo;
      }>("/api/session");

      if (!session.authenticated) {
        router.replace("/");
        return;
      }

      setUser(session.user);

      const repoData = await api<{ repositories: Repo[] }>("/api/repos");
      const repoList = repoData.repositories || [];
      setRepos(repoList);
      setReposEmpty(repoList.length === 0);
    } catch {
      router.replace("/");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadDashboardData();

    // Clean ?auth=success from URL
    if (new URLSearchParams(window.location.search).get("auth") === "success") {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [loadDashboardData]);

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else {
        next.add(fullName);
      }
      return next;
    });
  }

  function showWarning(msg: string) {
    setSyncMessage(msg);
    setSyncMessageType("warning");
  }

  function formatTokenSyncMessage(
    tokenSync: TokenSync | undefined,
  ): string | null {
    if (!tokenSync || tokenSync.ok) return null;
    const failed = Array.isArray(tokenSync.failed)
      ? tokenSync.failed.join(", ")
      : "";
    return `Token sync failed${failed ? ` for ${failed}` : ""}; PR commenting may use fallback token.`;
  }

  async function syncWebhooks() {
    const selected = Array.from(selectedRepos);
    if (!selected.length) {
      showWarning("Select at least one repository before syncing webhooks.");
      return;
    }

    setSyncing(true);
    setSyncMessage("Syncing repositories...");
    setSyncMessageType("info");

    try {
      const result = await api<{
        results: SyncResultEntry[];
        tokenSync?: TokenSync;
      }>("/api/webhooks/sync", {
        method: "POST",
        body: JSON.stringify({ repos: selected, testMode }),
      });

      const lines = result.results.map(
        (entry) =>
          `${entry.repo}: ${entry.status.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase())} - ${entry.message}`,
      );
      const tokenMsg = formatTokenSyncMessage(result.tokenSync);
      if (tokenMsg) lines.push(tokenMsg);

      setSyncMessage(lines.join("\n"));
      setSyncMessageType("info");
    } catch (error) {
      setSyncMessage(
        error instanceof Error ? error.message : "Failed to sync webhooks",
      );
      setSyncMessageType("info");
    } finally {
      setSyncing(false);
    }
  }

  async function runNow() {
    const selected = Array.from(selectedRepos);
    if (!selected.length) {
      showWarning("Select at least one repository before running.");
      return;
    }
    if (!runBaseUrl.trim()) {
      showWarning("Enter a deployment URL before running.");
      return;
    }

    setRunning(true);
    setSyncMessage("Running selected repos on default branch...");
    setSyncMessageType("info");

    try {
      const result = await api<{
        results: SyncResultEntry[];
        tokenSync?: TokenSync;
      }>("/api/runs/default-branch", {
        method: "POST",
        body: JSON.stringify({
          repos: selected,
          baseUrl: runBaseUrl.trim(),
          mode: "smoke",
          includeJudge: true,
        }),
      });

      const lines = result.results.map((entry) => {
        const state = entry.status
          .replace("_", " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        const link = entry.statusUrl
          ? ` (<a class="underline" href="${entry.statusUrl}" target="_blank">status</a>)`
          : "";
        return `${entry.repo}: ${state} - ${entry.message}${link}`;
      });
      const tokenMsg = formatTokenSyncMessage(result.tokenSync);
      if (tokenMsg) lines.push(tokenMsg);

      setSyncMessage(lines.join("\n"));
      setSyncMessageType("info");
    } catch (error) {
      setSyncMessage(
        error instanceof Error ? error.message : "Failed to run now",
      );
      setSyncMessageType("info");
    } finally {
      setRunning(false);
    }
  }

  async function logout() {
    await api("/api/logout", { method: "POST" }).catch(() => {});
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans min-h-screen flex items-center justify-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans transition-colors duration-300 min-h-screen flex flex-col">
      <DashboardNavbar
        avatarUrl={user?.avatarUrl ?? ""}
        login={user?.login ?? ""}
        onLogout={logout}
      />

      <main className="flex-grow relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 relative z-10">
          <div className="bg-white/50 dark:bg-surface-dark/60 border border-gray-200 dark:border-white/10 rounded-3xl p-8 md:p-10 glow-box">
            {/* Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  Dashboard
                </p>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Connected GitHub account
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Enable repositories and apply Autobot webhooks so PR events
                  trigger QA runs.
                </p>
              </div>
            </div>

            {/* User info + sync button */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
              <div className="flex items-center gap-3">
                {user?.avatarUrl && (
                  <img
                    alt="user"
                    className="h-12 w-12 rounded-full ring-2 ring-purple-400/70"
                    src={user.avatarUrl}
                  />
                )}
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {user?.name || "GitHub User"}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400 font-mono">
                    @{user?.login}
                  </p>
                </div>
              </div>
              <button
                onClick={syncWebhooks}
                disabled={syncing}
                className="bg-accent-cyan text-black px-6 py-3 text-sm font-bold hover:bg-accent-cyan/80 transition disabled:opacity-50"
              >
                {syncing ? "Syncing..." : "Enable webhook on selected repos"}
              </button>
            </div>

            {/* Test mode selector */}
            <div className="mt-4 mb-8">
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                QA test mode for webhook-triggered runs
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                {([
                  { value: "screenshots-only" as const, label: "Screenshots Only", desc: "Visual QA with GPT-4o judge" },
                  { value: "scriptgen" as const, label: "Basic Clickthrough", desc: "AI-generated Playwright tests (~$0.30/run)" },
                  { value: "agentic" as const, label: "Powerful Agentic", desc: "Real-time AI browser testing (~$1.50/run)" },
                ]).map((option) => (
                  <label
                    key={option.value}
                    className={`flex-1 cursor-pointer rounded-xl border p-3 transition ${
                      testMode === option.value
                        ? "border-purple-500 bg-purple-500/10 dark:bg-purple-500/15"
                        : "border-gray-200 dark:border-white/10 bg-white/40 dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20"
                    }`}
                  >
                    <input
                      type="radio"
                      name="testMode"
                      value={option.value}
                      checked={testMode === option.value}
                      onChange={() => setTestMode(option.value)}
                      className="sr-only"
                    />
                    <span className="block font-medium text-sm text-gray-900 dark:text-white">
                      {option.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {option.desc}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Run now */}
            <div className="mb-8 grid gap-3">
              <label
                htmlFor="run-base-url"
                className="text-sm text-gray-600 dark:text-gray-300"
              >
                Run now target URL (custom environment)
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  id="run-base-url"
                  className="flex-1 rounded-lg border border-gray-300 dark:border-white/10 bg-white/70 dark:bg-black/20 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500/40"
                  placeholder="https://your-app.example.com"
                  value={runBaseUrl}
                  onChange={(e) => setRunBaseUrl(e.target.value)}
                />
                <button
                  onClick={runNow}
                  disabled={running}
                  className="bg-accent-cyan text-black px-5 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition disabled:opacity-50"
                >
                  {running
                    ? "Queuing runs..."
                    : "Run now on selected repos (default branch)"}
                </button>
              </div>
            </div>

            {/* Loading / empty states */}
            {loading && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Loading repositories...
              </p>
            )}
            {reposEmpty && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                No repositories with webhook admin access were found.
              </p>
            )}

            {/* Repo list */}
            <div className="bg-background-light/70 dark:bg-black/25 rounded-2xl border border-gray-200 dark:border-white/10 p-4 md:p-5">
              <div className="space-y-3 max-h-80 overflow-auto pr-2">
                {repos.map((repo) => (
                  <label
                    key={repo.fullName}
                    className="flex items-center justify-between gap-4 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 bg-white/40 dark:bg-white/5"
                  >
                    <span className="inline-flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedRepos.has(repo.fullName)}
                        onChange={() => toggleRepo(repo.fullName)}
                        className="h-4 w-4 rounded-sm border-gray-300"
                      />
                      <span className="truncate">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {repo.fullName}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">
                          {repo.description || "No description"}
                        </span>
                      </span>
                    </span>
                    <span
                      className={`text-xs text-gray-500 dark:text-gray-400 ${repo.private ? "text-yellow-400" : ""}`}
                    >
                      {repo.private ? "Private" : "Public"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Sync/Run result message */}
            {syncMessage && (
              <div
                className={`mt-6 text-sm rounded-xl border p-4 ${
                  syncMessageType === "warning"
                    ? "border-amber-300/40 bg-amber-200/20 dark:bg-amber-400/10 text-amber-300"
                    : "border-gray-200 dark:border-white/10 bg-white/50 dark:bg-black/25"
                }`}
                dangerouslySetInnerHTML={{
                  __html: syncMessage
                    .split("\n")
                    .map((line) => `<div>${line}</div>`)
                    .join(""),
                }}
              />
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
