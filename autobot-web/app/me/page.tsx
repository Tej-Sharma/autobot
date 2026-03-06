"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";

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

export default function MePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [inputEmail, setInputEmail] = useState("");
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
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

      // Load run details for each job
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
  }

  function scoreColor(score: number): string {
    if (score > 80) return "text-green-400";
    if (score > 50) return "text-yellow-400";
    return "text-red-400";
  }

  function statusBadge(status: string): string {
    switch (status) {
      case "succeeded": return "bg-green-500/20 text-green-400";
      case "failed": return "bg-red-500/20 text-red-400";
      case "running": return "bg-blue-500/20 text-blue-400";
      default: return "bg-gray-500/20 text-gray-400";
    }
  }

  async function handleUpgrade() {
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

  return (
    <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[400px] bg-gradient-to-b from-purple-500/10 to-transparent blur-[120px] pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24 relative z-10">
          {upgraded && (
            <div className="mb-6 rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-3 text-center">
              <span className="text-green-400 font-semibold text-sm">Welcome to Pro! Your daily monitoring is now active.</span>
            </div>
          )}

          {!email ? (
            <div className="text-center py-16">
              <span className="material-icons text-4xl text-accent-purple mb-4">person</span>
              <h2 className="text-2xl font-bold dark:text-white mb-2">Your Dashboard</h2>
              <p className="text-gray-500 dark:text-gray-400 mb-8">Enter the email you used to receive your QA report.</p>
              <form onSubmit={handleLogin} className="max-w-sm mx-auto flex gap-2">
                <input
                  type="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="flex-1 px-4 py-3 rounded-lg border border-gray-200 dark:border-border-dark bg-transparent text-sm dark:text-white outline-none focus:border-accent-purple"
                />
                <button
                  type="submit"
                  className="bg-gradient-to-r from-accent-purple to-accent-blue text-white px-5 py-3 rounded-lg text-sm font-semibold hover:scale-105 transition-transform"
                >
                  Continue
                </button>
              </form>
            </div>
          ) : loading ? (
            <div className="text-center py-16">
              <span className="inline-block w-8 h-8 border-3 border-accent-purple/30 border-t-accent-purple rounded-full animate-spin mb-4" />
              <p className="text-gray-500">Loading your runs...</p>
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <p className="text-gray-400 mb-4">{error}</p>
              <Link href="/" className="text-accent-purple hover:underline">Run a test</Link>
            </div>
          ) : profile && (
            <div>
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
                <div>
                  <h2 className="text-2xl font-bold dark:text-white">Your QA Dashboard</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{profile.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    profile.subscription.active
                      ? "bg-accent-purple/20 text-accent-purple border border-accent-purple/30"
                      : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                  }`}>
                    {profile.subscription.active ? "Pro Plan" : "Free"}
                  </span>
                  {!profile.subscription.active && (
                    <button
                      onClick={handleUpgrade}
                      className="bg-gradient-to-r from-accent-purple to-accent-blue text-white px-4 py-2 rounded-full text-xs font-semibold hover:scale-105 transition-transform"
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
                  className="inline-flex items-center gap-2 text-sm text-accent-purple hover:underline"
                >
                  <span className="material-icons text-base">add_circle</span>
                  Run a new test
                </Link>
              </div>

              {/* Run history */}
              <h3 className="text-lg font-semibold dark:text-white mb-4">Run History ({runs.length})</h3>
              {runs.length === 0 ? (
                <p className="text-gray-500 text-sm">No runs yet. <Link href="/" className="text-accent-purple hover:underline">Test your first app</Link></p>
              ) : (
                <div className="space-y-3">
                  {runs.map((run) => (
                    <Link
                      key={run.id}
                      href={`/run/${run.id}`}
                      className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark px-4 py-3 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(run.status)}`}>
                          {run.status}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium dark:text-white truncate">
                            {run.report?.baseUrl || run.id}
                          </p>
                          <p className="text-xs text-gray-500">
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
                        <span className="material-icons text-gray-400 text-sm">chevron_right</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {/* Pro features teaser */}
              {!profile.subscription.active && (
                <div className="mt-10 rounded-xl border border-accent-purple/30 bg-gradient-to-r from-accent-purple/5 to-accent-blue/5 p-6">
                  <h3 className="text-base font-semibold dark:text-white mb-3">Upgrade to Pro</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-purple text-lg mt-0.5">schedule</span>
                      <div>
                        <p className="text-sm font-medium dark:text-white">Daily monitoring</p>
                        <p className="text-xs text-gray-500">Automated runs every 24h</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-purple text-lg mt-0.5">notifications_active</span>
                      <div>
                        <p className="text-sm font-medium dark:text-white">Instant alerts</p>
                        <p className="text-xs text-gray-500">Email when regressions hit</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="material-icons text-accent-purple text-lg mt-0.5">all_inclusive</span>
                      <div>
                        <p className="text-sm font-medium dark:text-white">Unlimited runs</p>
                        <p className="text-xs text-gray-500">No daily limits</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={handleUpgrade}
                    className="bg-gradient-to-r from-accent-purple to-accent-blue text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:scale-105 transition-transform"
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
