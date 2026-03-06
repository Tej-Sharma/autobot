"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import Link from "next/link";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

interface MonitoredUrl {
  url: string;
  email: string;
  intervalHours: number;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastJobId?: string;
  credentials?: string;
}

interface LeadProfile {
  email: string;
  runs: string[];
  subscription: { plan: string; active: boolean };
}

interface RunSummary {
  id: string;
  status: string;
  createdAt: string;
  progressMessage?: string;
  report?: {
    baseUrl: string;
    totals: { score: number; blocking: number; high: number; medium: number; low: number };
  };
}

export default function MePageWrapper() {
  return (
    <Suspense>
      <MePage />
    </Suspense>
  );
}

function MePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [inputEmail, setInputEmail] = useState("");
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [monitors, setMonitors] = useState<MonitoredUrl[]>([]);
  const [newMonitorUrl, setNewMonitorUrl] = useState("");
  const [newMonitorInterval, setNewMonitorInterval] = useState(24);
  const [newMonitorCredentials, setNewMonitorCredentials] = useState("");
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upgraded = searchParams.get("upgraded") === "true";

  useEffect(() => {
    const saved = localStorage.getItem("autobot_email");
    if (saved) {
      setEmail(saved);
      setInputEmail(saved);
    }
  }, []);

  const loadProfile = useCallback(async (e: string) => {
    if (!e) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/me?email=${encodeURIComponent(e)}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError("No account found for this email. Run a test first!");
          setProfile(null);
          return;
        }
        throw new Error("Failed to load profile");
      }
      const data = await res.json();
      setProfile(data);

      const runDetails = await Promise.all(
        (data.runs as string[]).slice(0, 20).map(async (jobId: string) => {
          try {
            const r = await fetch(`/api/qa/jobs/${jobId}`);
            if (!r.ok) return null;
            return await r.json();
          } catch {
            return null;
          }
        })
      );
      setRuns(runDetails.filter(Boolean) as RunSummary[]);

      try {
        const mRes = await fetch(`/api/monitors?email=${encodeURIComponent(e)}`);
        if (mRes.ok) {
          const mData = await mRes.json();
          setMonitors(mData.monitors || []);
        }
      } catch { /* monitors are optional */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (email) loadProfile(email);
  }, [email, loadProfile]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputEmail.trim().toLowerCase();
    if (!trimmed) return;
    localStorage.setItem("autobot_email", trimmed);
    setEmail(trimmed);
    posthog.identify(trimmed, { email: trimmed });
    posthog.capture("dashboard_login", { email: trimmed });
  }

  function scoreColor(score: number): string {
    if (score > 80) return "text-accent-green";
    if (score > 50) return "text-accent-amber";
    return "text-red-400";
  }

  function statusBadge(status: string): string {
    switch (status) {
      case "succeeded": return "bg-accent-green/10 text-accent-green border border-accent-green/20";
      case "failed": return "bg-red-500/10 text-red-400 border border-red-500/20";
      case "running": return "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20";
      default: return "bg-gray-500/10 text-gray-500 border border-gray-500/20";
    }
  }

  async function handleUpgrade() {
    posthog.capture("upgrade_to_pro_clicked", { source: "dashboard", email });
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || "Checkout not available");
    } catch {
      setError("Stripe is not configured yet");
    }
  }

  async function addMonitorUrl(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newMonitorUrl.trim();
    if (!trimmed) return;
    try { new URL(trimmed); } catch { setError("Invalid URL"); return; }

    setMonitorLoading(true);
    posthog.capture("monitor_added", { url: trimmed, interval_hours: newMonitorInterval, has_credentials: !!newMonitorCredentials });
    try {
      const res = await fetch("/api/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          url: trimmed,
          intervalHours: newMonitorInterval,
          credentials: newMonitorCredentials || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed to add monitor"); return; }
      setMonitors(data.monitors);
      setNewMonitorUrl("");
    } catch {
      setError("Failed to add monitor");
    } finally {
      setMonitorLoading(false);
    }
  }

  async function deleteMonitor(url: string) {
    posthog.capture("monitor_deleted", { url });
    try {
      const res = await fetch("/api/monitors", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, url }),
      });
      const data = await res.json();
      if (res.ok) setMonitors(data.monitors);
    } catch { /* ignore */ }
  }

  async function toggleMonitorEnabled(url: string, enabled: boolean) {
    try {
      const res = await fetch("/api/monitors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, url, enabled }),
      });
      const data = await res.json();
      if (res.ok) setMonitors(data.monitors);
    } catch { /* ignore */ }
  }

  return (
    <div className="bg-background-dark text-gray-200 antialiased font-mono min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative">
        <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24 relative z-10">
          {upgraded && (
            <div className="mb-6 border border-accent-green/30 bg-accent-green/5 px-4 py-3 text-center">
              <span className="text-accent-green font-bold text-sm">Welcome to Pro! Your daily monitoring is now active.</span>
            </div>
          )}

          {!email ? (
            <div className="text-center py-16">
              <span className="material-icons text-4xl text-accent-cyan mb-4">person</span>
              <h2 className="text-2xl font-bold text-white mb-2">Your Dashboard</h2>
              <p className="text-gray-500 mb-8 text-sm">Enter the email you used to receive your QA report.</p>
              <form onSubmit={handleLogin} className="max-w-sm mx-auto flex gap-2">
                <input
                  type="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 px-4 py-2.5 border border-border-dark bg-surface-dark text-sm text-white outline-none focus:border-accent-cyan"
                />
                <button
                  type="submit"
                  className="bg-accent-cyan text-black px-5 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors"
                >
                  Continue
                </button>
              </form>
            </div>
          ) : loading ? (
            <div className="text-center py-16">
              <span className="inline-block w-8 h-8 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin mb-4" />
              <p className="text-gray-500 text-sm">Loading your runs...</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-gray-500 mb-4 text-sm">{error}</p>
              <Link href="/" className="text-accent-cyan hover:underline text-sm">Run a test</Link>
            </div>
          ) : profile && (
            <div>
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-white">Your QA Dashboard</h2>
                  <p className="text-sm text-gray-500">{profile.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 text-xs font-bold ${
                    profile.subscription.active
                      ? "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20"
                      : "bg-gray-500/10 text-gray-500 border border-gray-500/20"
                  }`}>
                    {profile.subscription.active ? "Pro Plan" : "Free"}
                  </span>
                  {!profile.subscription.active && (
                    <button
                      onClick={handleUpgrade}
                      className="border border-accent-cyan text-accent-cyan px-4 py-1.5 text-xs font-bold hover:bg-accent-cyan/10 transition-colors"
                    >
                      Upgrade to Pro
                    </button>
                  )}
                </div>
              </div>

              {/* Quick action */}
              <div className="mb-8">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 text-sm text-accent-cyan hover:underline"
                >
                  <span className="material-icons text-base">add_circle</span>
                  Run a new test
                </Link>
              </div>

              {/* Run history */}
              <h3 className="text-lg font-bold text-white mb-4">Run History ({runs.length})</h3>
              {runs.length === 0 ? (
                <p className="text-gray-500 text-sm">No runs yet. <Link href="/" className="text-accent-cyan hover:underline">Test your first app</Link></p>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/run/${run.id}`}
                      className="flex items-center justify-between gap-4 border border-border-dark bg-surface-dark px-4 py-3 hover:border-accent-cyan/20 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`px-2 py-0.5 text-xs font-bold ${statusBadge(run.status)}`}>
                          {run.status}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white truncate">
                            {run.report?.baseUrl || run.id}
                          </p>
                          <p className="text-xs text-gray-600">
                            {new Date(run.createdAt).toLocaleDateString()} {new Date(run.createdAt).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {run.report?.totals && (
                          <span className={`text-lg font-bold ${scoreColor(run.report.totals.score)}`}>
                            {run.report.totals.score}
                          </span>
                        )}
                        <span className="material-icons text-gray-600 text-sm">chevron_right</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {/* Monitoring section (pro users) */}
              {profile.subscription.active && (
                <div className="mt-10">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="material-icons text-accent-cyan text-xl">monitoring</span>
                    Monitored URLs ({monitors.length})
                  </h3>

                  <form onSubmit={addMonitorUrl} className="mb-4 space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={newMonitorUrl}
                        onChange={(e) => setNewMonitorUrl(e.target.value)}
                        placeholder="https://your-app.com"
                        className="flex-1 px-4 py-2.5 border border-border-dark bg-surface-dark text-sm text-white outline-none focus:border-accent-cyan"
                        disabled={monitorLoading}
                      />
                      <select
                        value={newMonitorInterval}
                        onChange={(e) => setNewMonitorInterval(Number(e.target.value))}
                        className="px-3 py-2.5 border border-border-dark bg-surface-dark text-sm text-white outline-none"
                      >
                        <option value={6}>Every 6h</option>
                        <option value={12}>Every 12h</option>
                        <option value={24}>Every 24h</option>
                        <option value={168}>Weekly</option>
                      </select>
                      <button
                        type="submit"
                        disabled={monitorLoading}
                        className="bg-accent-cyan text-black px-5 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        {monitorLoading ? "Adding..." : "Add Monitor"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-accent-cyan text-xs">&gt;</span>
                      <input
                        type="text"
                        value={newMonitorCredentials}
                        onChange={(e) => setNewMonitorCredentials(e.target.value)}
                        placeholder="credentials (login/password) of a test account to use"
                        className="flex-1 px-4 py-2 border border-border-dark bg-black text-sm text-gray-400 outline-none focus:border-accent-cyan focus:text-white placeholder:text-gray-700"
                        disabled={monitorLoading}
                      />
                    </div>
                    <p className="text-[10px] text-gray-600 pl-5">Format: email:user@test.com / password:secret123 — fed to the AI agent for testing authenticated flows</p>
                  </form>

                  {monitors.length === 0 ? (
                    <p className="text-sm text-gray-500">No monitored URLs yet. Add one above to start daily QA runs.</p>
                  ) : (
                    <div className="space-y-2">
                      {monitors.map((m) => (
                        <div
                          key={m.url}
                          className="flex items-center justify-between gap-3 border border-border-dark bg-surface-dark px-4 py-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              type="button"
                              onClick={() => toggleMonitorEnabled(m.url, !m.enabled)}
                              className={`flex-shrink-0 w-9 h-5 transition-colors relative ${
                                m.enabled ? "bg-accent-cyan" : "bg-gray-700"
                              }`}
                            >
                              <span className={`absolute top-0.5 w-4 h-4 bg-black transition-transform ${
                                m.enabled ? "left-[18px]" : "left-0.5"
                              }`} />
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">{m.url}</p>
                              <p className="text-xs text-gray-600">
                                Every {m.intervalHours}h
                                {m.credentials && " · has credentials"}
                                {m.lastRunAt && ` · Last: ${new Date(m.lastRunAt).toLocaleDateString()}`}
                                {m.lastJobId && (
                                  <Link href={`/run/${m.lastJobId}`} className="text-accent-cyan hover:underline ml-1">
                                    View
                                  </Link>
                                )}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteMonitor(m.url)}
                            className="text-gray-600 hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <span className="material-icons text-lg">delete_outline</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Pro features teaser */}
              {!profile.subscription.active && (
                <div className="mt-10 border border-accent-cyan/20 bg-accent-cyan/5 p-6">
                  <h3 className="text-base font-bold text-white mb-3">Upgrade to Pro</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-cyan text-lg mt-0.5">schedule</span>
                      <div>
                        <p className="text-sm font-bold text-white">Daily monitoring</p>
                        <p className="text-xs text-gray-500">Automated runs every 24h</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-amber text-lg mt-0.5">notifications_active</span>
                      <div>
                        <p className="text-sm font-bold text-white">Instant alerts</p>
                        <p className="text-xs text-gray-500">Email when regressions hit</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-green text-lg mt-0.5">all_inclusive</span>
                      <div>
                        <p className="text-sm font-bold text-white">Unlimited runs</p>
                        <p className="text-xs text-gray-500">No daily limits</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleUpgrade}
                    className="bg-accent-cyan text-black px-6 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
