"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "../../../components/Navbar";
import { Footer } from "../../../components/Footer";

interface Finding {
  severity: string;
  category: string;
  message: string;
  suggestion?: string;
}

interface PhaseJudgment {
  score: number;
  findings: Finding[];
}

interface Phase {
  routeKey: string;
  routePath: string;
  viewport: string;
  screenshotPath: string;
  screenshotBase64?: string;
  status: string;
  judge?: PhaseJudgment;
}

interface Totals {
  score: number;
  blocking: number;
  high: number;
  medium: number;
  low: number;
  capturedPhases: number;
  failedPhases: number;
}

interface Report {
  phases: Phase[];
  totals: Totals;
  baseUrl: string;
}

interface JobStatus {
  id: string;
  status: string;
  progressMessage?: string;
  error?: string;
  reportPath?: string;
}

const PROGRESS_STEPS = [
  { label: "Preparing...", keywords: ["received", "queued", "preparing"] },
  { label: "Crawling pages...", keywords: ["crawl", "routes", "discovering"] },
  { label: "Capturing screenshots...", keywords: ["captur", "screenshot", "browser", "navigat"] },
  { label: "Running AI analysis...", keywords: ["judg", "analy", "scor", "openai"] },
];

function getActiveStep(status: string, progressMessage?: string): number {
  if (status === "received" || status === "queued") return 0;
  if (!progressMessage) return 1;
  const msg = progressMessage.toLowerCase();
  for (let i = PROGRESS_STEPS.length - 1; i >= 0; i--) {
    if (PROGRESS_STEPS[i].keywords.some((kw) => msg.includes(kw))) return i;
  }
  return 1;
}

function scoreColor(score: number): string {
  if (score > 80) return "text-green-400 border-green-400/30 bg-green-400/10";
  if (score > 50) return "text-yellow-400 border-yellow-400/30 bg-yellow-400/10";
  return "text-red-400 border-red-400/30 bg-red-400/10";
}

function severityColor(severity: string): string {
  switch (severity) {
    case "blocking": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "high": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "medium": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "low": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function isTerminal(status: string): boolean {
  return ["succeeded", "partial", "failed"].includes(status);
}

export default function RunPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [job, setJob] = useState<JobStatus | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<Report | null>(null);
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/qa/jobs/${jobId}`);
      if (!res.ok) {
        setFetchError("Could not find this test run.");
        return;
      }
      const data = await res.json();
      setJob(data);
      setFetchError(null);

      // Use the inlined report from the job status response
      if (isTerminal(data.status) && data.report && !report) {
        setReport(data.report);
      }
    } catch {
      setFetchError("Network error. Retrying...");
    }
  }, [jobId, report]);

  useEffect(() => {
    fetchJob();
    const interval = setInterval(() => {
      // Keep polling if not terminal, or if terminal but report hasn't loaded yet
      if (job && isTerminal(job.status) && report) return;
      fetchJob();
    }, 2000);
    return () => clearInterval(interval);
  }, [fetchJob, job?.status, report]);

  const toggleFinding = (idx: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  async function handleEmailCapture(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Please enter a valid email");
      return;
    }
    setEmailStatus("sending");
    setEmailError(null);
    try {
      const res = await fetch("/api/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, jobId, url: report?.baseUrl ?? "" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send");
      }
      setEmailStatus("sent");
      localStorage.setItem("autobot_email", trimmed);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send");
      setEmailStatus("error");
    }
  }

  async function handleUpgrade() {
    const savedEmail = email.trim().toLowerCase() || localStorage.getItem("autobot_email") || "";
    if (!savedEmail) {
      setEmailError("Enter your email first to upgrade");
      return;
    }
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: savedEmail, jobId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setEmailError(data.error || "Checkout not available yet");
      }
    } catch {
      setEmailError("Stripe is not configured yet. Coming soon!");
    }
  }

  const terminal = job ? isTerminal(job.status) : false;

  return (
    <div className="bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-200 antialiased font-sans min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[400px] bg-gradient-to-b from-purple-500/10 to-transparent blur-[120px] pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24 relative z-10">
          {fetchError && !job && (
            <div className="text-center py-20">
              <p className="text-lg text-gray-400">{fetchError}</p>
              <Link href="/" className="mt-4 inline-block text-accent-purple hover:underline">
                Back to home
              </Link>
            </div>
          )}

          {job && !terminal && <ProgressView job={job} />}
          {job && terminal && !report && (
            <FailedView error={job.error || (job.status !== "failed" ? "Report data is loading. Please refresh the page." : undefined)} />
          )}
          {job && terminal && report && (
            <ResultsView
              jobId={jobId}
              report={report}
              expandedFindings={expandedFindings}
              toggleFinding={toggleFinding}
              email={email}
              setEmail={setEmail}
              emailStatus={emailStatus}
              emailError={emailError}
              onEmailCapture={handleEmailCapture}
              onUpgrade={handleUpgrade}
            />
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

function ProgressView({ job }: { job: JobStatus }) {
  const activeStep = getActiveStep(job.status, job.progressMessage);

  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-purple/10 text-accent-purple text-sm font-medium mb-8">
        <span className="inline-block w-2 h-2 rounded-full bg-accent-purple animate-pulse" />
        Testing in progress
      </div>

      <h2 className="text-2xl font-bold dark:text-white mb-2">Analyzing your app...</h2>
      {job.progressMessage && (
        <p className="text-gray-500 dark:text-gray-400 mb-12">{job.progressMessage}</p>
      )}

      <div className="max-w-md mx-auto space-y-4">
        {PROGRESS_STEPS.map((step, i) => {
          const isActive = i === activeStep;
          const isDone = i < activeStep;
          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                isActive
                  ? "bg-accent-purple/10 border border-accent-purple/30"
                  : isDone
                  ? "opacity-60"
                  : "opacity-30"
              }`}
            >
              <div className="flex-shrink-0">
                {isDone ? (
                  <span className="material-icons text-green-400 text-xl">check_circle</span>
                ) : isActive ? (
                  <span className="inline-block w-5 h-5 border-2 border-accent-purple/30 border-t-accent-purple rounded-full animate-spin" />
                ) : (
                  <span className="inline-block w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                )}
              </div>
              <span className={`text-sm font-medium ${isActive ? "dark:text-white" : ""}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FailedView({ error }: { error?: string }) {
  return (
    <div className="text-center py-16">
      <span className="material-icons text-red-400 text-5xl mb-4">error_outline</span>
      <h2 className="text-2xl font-bold dark:text-white mb-2">Test Run Failed</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6">{error || "An unexpected error occurred."}</p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-gradient-to-r from-accent-purple to-accent-blue text-white px-6 py-3 rounded-full text-sm font-semibold hover:scale-105 transition-transform"
      >
        Try Again
      </Link>
    </div>
  );
}

function ResultsView({
  jobId,
  report,
  expandedFindings,
  toggleFinding,
  email,
  setEmail,
  emailStatus,
  emailError,
  onEmailCapture,
  onUpgrade,
}: {
  jobId: string;
  report: Report;
  expandedFindings: Set<number>;
  toggleFinding: (idx: number) => void;
  email: string;
  setEmail: (v: string) => void;
  emailStatus: "idle" | "sending" | "sent" | "error";
  emailError: string | null;
  onEmailCapture: (e: React.FormEvent) => void;
  onUpgrade: () => void;
}) {
  const { totals, phases } = report;

  function screenshotSrc(phase: Phase): string | null {
    // Prefer base64 data embedded in the report (works across separate services)
    if (phase.screenshotBase64) {
      return `data:image/png;base64,${phase.screenshotBase64}`;
    }
    // Fallback to artifact path (only works when server/worker share disk)
    if (!phase.screenshotPath) return null;
    const jobIdIdx = phase.screenshotPath.indexOf(jobId);
    if (jobIdIdx !== -1) {
      const relative = phase.screenshotPath.slice(jobIdIdx + jobId.length + 1);
      return `/artifacts/${jobId}/${relative}`;
    }
    if (phase.screenshotPath.startsWith("/")) return phase.screenshotPath;
    return `/artifacts/${jobId}/${phase.screenshotPath}`;
  }
  const allFindings: Finding[] = phases.flatMap((p) => p.judge?.findings ?? []);

  return (
    <div>
      {/* Score badge */}
      <div className="text-center mb-10">
        <div className={`inline-flex items-center justify-center w-28 h-28 rounded-full border-4 text-4xl font-bold mb-4 ${scoreColor(totals.score)}`}>
          {totals.score}
        </div>
        <h2 className="text-2xl font-bold dark:text-white mb-1">QA Score</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-2">
          {report.baseUrl}
        </p>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-500/10 text-gray-500 dark:text-gray-400 border border-gray-500/20">
          <span className="material-icons text-xs">visibility</span>
          Basic visual test — screenshots &amp; layout checks only
        </span>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap justify-center gap-3 mb-10">
        {totals.blocking > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
            {totals.blocking} blocking
          </span>
        )}
        {totals.high > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
            {totals.high} high
          </span>
        )}
        {totals.medium > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            {totals.medium} medium
          </span>
        )}
        {totals.low > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
            {totals.low} low
          </span>
        )}
        {allFindings.length === 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
            No issues found
          </span>
        )}
      </div>

      {/* Screenshot grid */}
      <h3 className="text-lg font-semibold dark:text-white mb-4">Screenshots</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {phases
          .filter((p) => p.status === "captured" && (p.screenshotBase64 || p.screenshotPath))
          .map((phase, i) => {
            const src = screenshotSrc(phase);
            if (!src) return null;
            return (
            <div
              key={i}
              className="rounded-xl overflow-hidden border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark"
            >
              <img
                src={src}
                alt={`${phase.routePath} - ${phase.viewport}`}
                className="w-full h-auto"
                loading="lazy"
              />
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium dark:text-white">{phase.routePath}</p>
                  <p className="text-xs text-gray-500">{phase.viewport}</p>
                </div>
                {phase.judge && (
                  <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${scoreColor(phase.judge.score)}`}>
                    {phase.judge.score}
                  </div>
                )}
              </div>
            </div>
            );
          })}
      </div>

      {/* Findings list */}
      {allFindings.length > 0 && (
        <>
          <h3 className="text-lg font-semibold dark:text-white mb-4">
            Findings ({allFindings.length})
          </h3>
          <div className="space-y-3 mb-10">
            {allFindings.map((finding, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleFinding(i)}
                className="w-full text-left rounded-xl border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark overflow-hidden transition-colors hover:border-gray-300 dark:hover:border-gray-600"
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${severityColor(finding.severity)}`}>
                    {finding.severity}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase">{finding.category}</span>
                  <span className="text-sm dark:text-white flex-1 truncate">{finding.message}</span>
                  <span className="material-icons text-gray-400 text-sm transition-transform" style={{
                    transform: expandedFindings.has(i) ? "rotate(180deg)" : "rotate(0deg)"
                  }}>
                    expand_more
                  </span>
                </div>
                {expandedFindings.has(i) && finding.suggestion && (
                  <div className="px-4 pb-3 pt-0 border-t border-gray-100 dark:border-border-dark">
                    <p className="text-sm text-gray-600 dark:text-gray-400 pt-3">{finding.suggestion}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Email capture */}
      <div className="mt-12 rounded-xl border border-gray-200 dark:border-border-dark bg-white dark:bg-surface-dark p-6">
        {emailStatus === "sent" ? (
          <div className="text-center">
            <span className="material-icons text-green-400 text-3xl mb-2">check_circle</span>
            <p className="text-sm font-medium dark:text-white">Report sent! Check your inbox.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-4">
              <span className="material-icons text-accent-purple text-2xl">email</span>
              <div>
                <p className="text-sm font-semibold dark:text-white">Get the full report emailed</p>
                <p className="text-xs text-gray-500">Screenshots, findings, and score — delivered to your inbox.</p>
              </div>
            </div>
            <form onSubmit={onEmailCapture} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-border-dark bg-transparent text-sm dark:text-white outline-none focus:border-accent-purple"
                disabled={emailStatus === "sending"}
              />
              <button
                type="submit"
                disabled={emailStatus === "sending"}
                className="bg-gradient-to-r from-accent-purple to-accent-blue text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:scale-105 transition-transform disabled:opacity-60 whitespace-nowrap"
              >
                {emailStatus === "sending" ? "Sending..." : "Send Report"}
              </button>
            </form>
            {emailError && <p className="mt-2 text-xs text-red-400">{emailError}</p>}
          </>
        )}
      </div>

      {/* Upgrade CTA */}
      <div className="mt-4 rounded-xl border border-accent-purple/30 bg-gradient-to-r from-accent-purple/5 to-accent-blue/5 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="material-icons text-accent-purple text-xl">rocket_launch</span>
              <p className="text-sm font-semibold dark:text-white">Go beyond screenshots — test actual user flows</p>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Pro runs AI-driven tests on signups, checkouts, form submissions, and more. Catch real bugs, not just visual ones.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-purple/10 text-accent-purple border border-accent-purple/20">Login flows</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-purple/10 text-accent-purple border border-accent-purple/20">Form validation</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-purple/10 text-accent-purple border border-accent-purple/20">API errors</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-purple/10 text-accent-purple border border-accent-purple/20">Daily monitoring</span>
            </div>
          </div>
          <button
            onClick={onUpgrade}
            className="bg-gradient-to-r from-accent-purple to-accent-blue text-white px-6 py-2.5 rounded-full text-sm font-semibold hover:scale-105 transition-transform whitespace-nowrap"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>

      {/* Try another */}
      <div className="text-center mt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-accent-purple to-accent-blue text-white px-6 py-3 rounded-full text-sm font-semibold hover:scale-105 transition-transform"
        >
          Test Another App
        </Link>
      </div>
    </div>
  );
}
