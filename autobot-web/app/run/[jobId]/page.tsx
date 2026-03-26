"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import posthog from "posthog-js";
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

interface AiTestFinding {
  severity: string;
  category: string;
  message: string;
  screenshot?: string;
  stepId?: string;
}

interface TrackedStep {
  id: string;
  name: string;
  url: string;
  actions: string[];
  checklist: { item: string; passed: boolean; notes?: string }[];
  observations: string;
  bugsFound: AiTestFinding[];
  screenshotKey?: string;
  isBacktrackPoint: boolean;
  backtrackExhausted: boolean;
}

interface AiTestReport {
  findings: AiTestFinding[];
  costUsd: number;
  durationMs: number;
  screenshotKeys: string[];
  steps?: TrackedStep[];
  backtrackLog?: { from: string; to: string; reason: string }[];
}

interface Report {
  phases: Phase[];
  totals: Totals;
  baseUrl: string;
  aiTestReport?: AiTestReport;
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
  { label: "Testing your app functionality...", keywords: ["crawl", "routes", "discovering"] },
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
  if (score > 75) return "text-accent-green border-accent-green/30 bg-accent-green/10";
  if (score > 50) return "text-accent-amber border-accent-amber/30 bg-accent-amber/10";
  return "text-red-400 border-red-400/30 bg-red-400/10";
}

function severityColor(severity: string): string {
  switch (severity) {
    case "blocking": return "bg-red-500/10 text-red-400 border border-red-500/20";
    case "high": return "bg-orange-500/10 text-orange-400 border border-orange-500/20";
    case "medium": return "bg-accent-amber/10 text-accent-amber border border-accent-amber/20";
    case "low": return "bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20";
    default: return "bg-gray-500/10 text-gray-500 border border-gray-500/20";
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

  useEffect(() => {
    const saved = localStorage.getItem("autobot_email");
    if (saved) {
      setEmail(saved);
      posthog.identify(saved, { email: saved });
    }
  }, []);

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

      if (isTerminal(data.status) && data.report && !report) {
        setReport(data.report);
        posthog.capture("test_results_viewed", {
          job_id: jobId,
          score: data.report.totals?.score,
          base_url: data.report.baseUrl,
          findings_count: data.report.phases?.flatMap((p: Phase) => p.judge?.findings ?? []).length ?? 0,
        });
      }
    } catch {
      setFetchError("Network error. Retrying...");
    }
  }, [jobId, report]);

  useEffect(() => {
    fetchJob();
    const interval = setInterval(() => {
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
    posthog.capture("email_report_submitted", { job_id: jobId, email: trimmed });
    try {
      const res = await fetch("/api/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, jobId, url: report?.baseUrl ?? "" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send");
      }
      localStorage.setItem("autobot_email", trimmed);
      posthog.identify(trimmed, { email: trimmed });
      if (data.emailSent) {
        setEmailStatus("sent");
      } else {
        setEmailError("We saved your email but couldn't send the report. Please check back soon.");
        setEmailStatus("error");
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send");
      setEmailStatus("error");
    }
  }

  async function handleUpgrade() {
    posthog.capture("upgrade_to_pro_clicked", { source: "results_page", job_id: jobId });
    const savedEmail = email.trim().toLowerCase() || localStorage.getItem("autobot_email") || "";
    if (!savedEmail) {
      setEmailError("Enter your email first to upgrade");
      return;
    }
    localStorage.setItem("autobot_email", savedEmail);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: savedEmail, jobId, url: report?.baseUrl ?? "" }),
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
    <div className="bg-background-dark text-gray-200 antialiased font-mono min-h-screen flex flex-col">
      <Navbar />

      <main className="flex-grow relative">
        <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-24 relative z-10">
          {fetchError && !job && (
            <div className="text-center py-20">
              <p className="text-lg text-gray-500">{fetchError}</p>
              <Link href="/" className="mt-4 inline-block text-accent-cyan hover:underline">
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
              emailError={emailError}
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
      <div className="inline-flex items-center gap-2 px-4 py-2 border border-accent-cyan/30 bg-accent-cyan/5 text-accent-cyan text-sm font-bold mb-8">
        <span className="inline-block w-2 h-2 bg-accent-cyan animate-blink" />
        Testing in progress
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">Analyzing your app...</h2>
      {job.progressMessage && (
        <p className="text-gray-500 mb-12 text-sm">{job.progressMessage}</p>
      )}

      <div className="max-w-md mx-auto space-y-3">
        {PROGRESS_STEPS.map((step, i) => {
          const isActive = i === activeStep;
          const isDone = i < activeStep;
          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 px-4 py-3 transition-all duration-300 ${
                isActive
                  ? "border border-accent-cyan/30 bg-accent-cyan/5"
                  : isDone
                  ? "opacity-60"
                  : "opacity-30"
              }`}
            >
              <div className="flex-shrink-0">
                {isDone ? (
                  <span className="material-icons text-accent-green text-xl">check_circle</span>
                ) : isActive ? (
                  <span className="inline-block w-5 h-5 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
                ) : (
                  <span className="inline-block w-5 h-5 border-2 border-gray-700" />
                )}
              </div>
              <span className={`text-sm font-bold ${isActive ? "text-white" : ""}`}>
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
      <h2 className="text-2xl font-bold text-white mb-2">Test Run Failed</h2>
      <p className="text-gray-500 mb-6 text-sm">{error || "An unexpected error occurred."}</p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 bg-accent-cyan text-black px-6 py-3 text-sm font-bold hover:bg-accent-cyan/80 transition-colors"
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
  emailError,
  onUpgrade,
}: {
  jobId: string;
  report: Report;
  expandedFindings: Set<number>;
  toggleFinding: (idx: number) => void;
  email: string;
  setEmail: (v: string) => void;
  emailError: string | null;
  onUpgrade: () => void;
}) {
  const { totals, phases } = report;
  const [showCloudEmail, setShowCloudEmail] = useState(false);

  function screenshotSrc(phase: Phase): string | null {
    if (phase.screenshotBase64) {
      return `data:image/png;base64,${phase.screenshotBase64}`;
    }
    if (!phase.screenshotPath) return null;
    const jobIdIdx = phase.screenshotPath.indexOf(jobId);
    if (jobIdIdx !== -1) {
      const relative = phase.screenshotPath.slice(jobIdIdx + jobId.length + 1);
      return `/artifacts/${jobId}/${relative}`;
    }
    if (phase.screenshotPath.startsWith("/")) return phase.screenshotPath;
    return `/artifacts/${jobId}/${phase.screenshotPath}`;
  }
  // Prefer agentic findings (from AI tester) over judge findings (from visual checks)
  const agenticFindings: Finding[] = (report.aiTestReport?.findings ?? []).map((f) => ({
    severity: f.severity,
    category: f.category,
    message: f.message,
  }));
  const judgeFindings: Finding[] = phases.flatMap((p) => p.judge?.findings ?? []);
  const allFindings: Finding[] = agenticFindings.length > 0 ? agenticFindings : judgeFindings;

  // Score capping: max 70 for free tier, lower if more bugs found
  const rawScore = totals.score;
  const bugCount = allFindings.length;
  const displayScore = bugCount >= 5 ? Math.min(rawScore, 42) : bugCount >= 3 ? Math.min(rawScore, 55) : Math.min(rawScore, 68);
  const bugMessage = bugCount >= 3
    ? `${bugCount} bugs found`
    : "2-3 bugs found";

  return (
    <div>
      {/* Score + label */}
      <div className="text-center mb-6">
        <div className={`inline-flex items-center justify-center w-28 h-28 border-2 text-4xl font-bold mb-4 ${scoreColor(displayScore)}`}>
          {displayScore}
        </div>
        <h2 className="text-2xl font-bold text-white mb-1">QA Score</h2>
        <p className="text-gray-500 text-sm mb-1">{report.baseUrl}</p>
        <p className="text-gray-600 text-xs">Free, low-power run completed</p>
      </div>

      {/* Bug warning banner */}
      <div className="flex items-center justify-center gap-3 mb-8 px-5 py-3.5 border border-accent-amber/30 bg-accent-amber/5 mx-auto max-w-lg">
        <span className="material-icons text-accent-amber text-2xl flex-shrink-0">warning</span>
        <div>
          <p className="text-sm font-bold text-accent-amber">{bugMessage}</p>
          <p className="text-xs text-gray-500 mt-0.5">These issues may be impacting user experience and conversions</p>
        </div>
      </div>

      {/* Execution Steps */}
      {report.aiTestReport?.steps && report.aiTestReport.steps.length > 0 && (
        <StepsView
          steps={report.aiTestReport.steps}
          backtrackLog={report.aiTestReport.backtrackLog ?? []}
          jobId={jobId}
        />
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap justify-center gap-3 mb-8">
        {totals.blocking > 0 && (
          <span className="px-3 py-1 text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20">
            {totals.blocking} blocking
          </span>
        )}
        {totals.high > 0 && (
          <span className="px-3 py-1 text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            {totals.high} high
          </span>
        )}
        {totals.medium > 0 && (
          <span className="px-3 py-1 text-xs font-bold bg-accent-amber/10 text-accent-amber border border-accent-amber/20">
            {totals.medium} medium
          </span>
        )}
        {totals.low > 0 && (
          <span className="px-3 py-1 text-xs font-bold bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/20">
            {totals.low} low
          </span>
        )}
      </div>

      {/* CTA section */}
      <div className="mb-10 border border-border-dark bg-surface-dark/80 p-6 text-center">
        <p className="text-sm text-gray-400 leading-relaxed mb-5">
          For full-powered testing that runs routinely to catch &amp; fix bugs as you push changes, self-host it yourself for free or upgrade to pro.
        </p>

        <div className="flex items-center justify-center gap-3">
          <a
            href="https://github.com/anthropics/autobot"
            target="_blank"
            rel="noopener noreferrer"
            className="border border-border-dark text-gray-400 px-5 py-2.5 text-sm font-bold hover:border-accent-cyan/40 hover:text-white transition-colors"
          >
            Self-host
          </a>
          <button
            onClick={() => setShowCloudEmail(true)}
            className="bg-accent-cyan text-black px-5 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors"
          >
            Get AutoBot Cloud
          </button>
        </div>

        {showCloudEmail && (
          <form
            onSubmit={(e) => { e.preventDefault(); onUpgrade(); }}
            className="flex gap-2 mt-4 max-w-md mx-auto"
            style={{ animation: "fadeSlideIn 0.2s ease-out" }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              className="flex-1 px-4 py-2.5 border border-border-dark bg-transparent text-sm text-white outline-none focus:border-accent-cyan/60 placeholder:text-gray-600"
            />
            <button
              type="submit"
              className="bg-accent-cyan text-black px-4 py-2.5 text-sm font-bold hover:bg-accent-cyan/80 transition-colors"
            >
              <span className="material-icons text-sm">arrow_forward</span>
            </button>
          </form>
        )}
        {emailError && <p className="mt-2 text-xs text-red-400">{emailError}</p>}
      </div>

      {/* Screenshot grid */}
      <h3 className="text-lg font-bold text-white mb-4">Screenshots</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {phases
          .filter((p) => p.status === "captured" && (p.screenshotBase64 || p.screenshotPath))
          .map((phase, i) => {
            const src = screenshotSrc(phase);
            if (!src) return null;
            return (
            <div
              key={i}
              className="overflow-hidden border border-border-dark bg-surface-dark"
            >
              <img
                src={src}
                alt={`${phase.routePath} - ${phase.viewport}`}
                className="w-full h-auto"
                loading="lazy"
              />
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{phase.routePath}</p>
                  <p className="text-xs text-gray-600">{phase.viewport}</p>
                </div>
                {phase.judge && (
                  <div className={`px-2 py-0.5 text-xs font-bold ${scoreColor(phase.judge.score)}`}>
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
          <h3 className="text-lg font-bold text-white mb-4">
            Findings ({allFindings.length})
          </h3>
          <div className="space-y-2 mb-10">
            {allFindings.map((finding, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleFinding(i)}
                className="w-full text-left border border-border-dark bg-surface-dark overflow-hidden transition-colors hover:border-accent-cyan/20"
              >
                <div className="px-4 py-3 flex items-center gap-3">
                  <span className={`px-2 py-0.5 text-xs font-bold ${severityColor(finding.severity)}`}>
                    {finding.severity}
                  </span>
                  <span className="text-xs text-gray-600 font-bold uppercase">{finding.category}</span>
                  <span className="text-sm text-white flex-1 truncate">{finding.message}</span>
                  <span className="material-icons text-gray-600 text-sm transition-transform" style={{
                    transform: expandedFindings.has(i) ? "rotate(180deg)" : "rotate(0deg)"
                  }}>
                    expand_more
                  </span>
                </div>
                {expandedFindings.has(i) && finding.suggestion && (
                  <div className="px-4 pb-3 pt-0 border-t border-border-dark">
                    <p className="text-sm text-gray-500 pt-3">{finding.suggestion}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Try another */}
      <div className="text-center mt-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 border border-accent-cyan text-accent-cyan px-6 py-3 text-sm font-bold hover:bg-accent-cyan/10 transition-colors"
        >
          Test Another App
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Steps View — shows the execution flow the agent walked through     */
/* ------------------------------------------------------------------ */

function StepsView({
  steps,
  backtrackLog,
  jobId,
}: {
  steps: TrackedStep[];
  backtrackLog: { from: string; to: string; reason: string }[];
  jobId: string;
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalChecks = steps.reduce((sum, s) => sum + s.checklist.length, 0);
  const passedChecks = steps.reduce(
    (sum, s) => sum + s.checklist.filter((c) => c.passed).length,
    0,
  );
  const totalBugs = steps.reduce((sum, s) => sum + s.bugsFound.length, 0);

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Test Execution Flow</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{steps.length} steps</span>
          <span>{passedChecks}/{totalChecks} checks passed</span>
          {totalBugs > 0 && (
            <span className="text-red-400">{totalBugs} bugs</span>
          )}
        </div>
      </div>

      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border-dark" />

        <div className="space-y-2">
          {steps.map((step, i) => {
            const isExpanded = expandedSteps.has(step.id);
            const hasBugs = step.bugsFound.length > 0;
            const checksPassed = step.checklist.filter((c) => c.passed).length;
            const checksTotal = step.checklist.length;
            const allPassed = checksTotal > 0 && checksPassed === checksTotal;

            // Find if there's a backtrack TO this step
            const backtrackTo = backtrackLog.find((b) => b.to === step.url);

            return (
              <div key={step.id}>
                {/* Backtrack indicator */}
                {backtrackTo && (
                  <div className="flex items-center gap-2 ml-8 mb-1 py-1">
                    <span className="material-icons text-accent-amber text-xs">undo</span>
                    <span className="text-xs text-accent-amber/80 italic">
                      Backtracked: {backtrackTo.reason}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => toggleStep(step.id)}
                  className="w-full text-left group"
                >
                  {/* Step header */}
                  <div className="flex items-start gap-3 relative">
                    {/* Timeline dot */}
                    <div className={`relative z-10 flex-shrink-0 w-8 h-8 flex items-center justify-center border ${
                      hasBugs
                        ? "border-red-500/40 bg-red-500/10"
                        : allPassed
                          ? "border-accent-green/40 bg-accent-green/10"
                          : "border-border-dark bg-surface-dark"
                    }`}>
                      {hasBugs ? (
                        <span className="material-icons text-red-400 text-sm">bug_report</span>
                      ) : allPassed ? (
                        <span className="material-icons text-accent-green text-sm">check</span>
                      ) : (
                        <span className="text-xs text-gray-500 font-bold">{i + 1}</span>
                      )}
                    </div>

                    {/* Step content */}
                    <div className={`flex-1 border bg-surface-dark/80 px-4 py-3 transition-colors ${
                      isExpanded ? "border-accent-cyan/30" : "border-border-dark group-hover:border-accent-cyan/20"
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{step.name}</span>
                          {step.isBacktrackPoint && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent-amber/10 text-accent-amber border border-accent-amber/20">
                              BRANCH
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {checksTotal > 0 && (
                            <span className={`text-xs font-bold ${allPassed ? "text-accent-green" : hasBugs ? "text-red-400" : "text-gray-500"}`}>
                              {checksPassed}/{checksTotal}
                            </span>
                          )}
                          <span
                            className="material-icons text-gray-600 text-sm transition-transform"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                          >
                            expand_more
                          </span>
                        </div>
                      </div>

                      {/* Actions summary (always visible) */}
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {step.actions.slice(0, 3).join(" · ")}
                        {step.actions.length > 3 && ` · +${step.actions.length - 3} more`}
                      </p>
                    </div>
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="ml-11 border border-t-0 border-border-dark bg-surface-dark/50 px-4 py-4 space-y-4" style={{ animation: "fadeSlideIn 0.15s ease-out" }}>
                    {/* URL */}
                    <div>
                      <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">URL</span>
                      <p className="text-xs text-gray-400 mt-0.5 break-all">{step.url}</p>
                    </div>

                    {/* Actions */}
                    {step.actions.length > 0 && (
                      <div>
                        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">Actions Performed</span>
                        <ul className="mt-1 space-y-0.5">
                          {step.actions.map((action, ai) => (
                            <li key={ai} className="text-xs text-gray-400 flex items-start gap-1.5">
                              <span className="text-gray-600 mt-0.5">›</span>
                              {action}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Checklist */}
                    {step.checklist.length > 0 && (
                      <div>
                        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">
                          Checklist ({checksPassed}/{checksTotal})
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {step.checklist.map((check, ci) => (
                            <li key={ci} className="text-xs flex items-start gap-1.5">
                              {check.passed ? (
                                <span className="text-accent-green mt-0.5 flex-shrink-0">✓</span>
                              ) : (
                                <span className="text-red-400 mt-0.5 flex-shrink-0">✗</span>
                              )}
                              <span className={check.passed ? "text-gray-400" : "text-red-300"}>
                                {check.item}
                                {check.notes && <span className="text-gray-600"> — {check.notes}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Observations */}
                    {step.observations && (
                      <div>
                        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">Observations</span>
                        <p className="text-xs text-gray-400 mt-0.5">{step.observations}</p>
                      </div>
                    )}

                    {/* Bugs found at this step */}
                    {step.bugsFound.length > 0 && (
                      <div>
                        <span className="text-[10px] text-gray-600 uppercase font-bold tracking-wider">
                          Bugs Found ({step.bugsFound.length})
                        </span>
                        <div className="mt-1 space-y-1">
                          {step.bugsFound.map((bug, bi) => (
                            <div
                              key={bi}
                              className="flex items-start gap-2 px-2 py-1.5 bg-red-500/5 border border-red-500/10"
                            >
                              <span className={`px-1.5 py-0.5 text-[10px] font-bold flex-shrink-0 ${severityColor(bug.severity)}`}>
                                {bug.severity}
                              </span>
                              <span className="text-xs text-gray-300">{bug.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Screenshot link */}
                    {step.screenshotKey && (
                      <div>
                        <a
                          href={`/artifacts/${jobId}/${step.screenshotKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-accent-cyan hover:underline"
                        >
                          View screenshot →
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Backtrack summary */}
      {backtrackLog.length > 0 && (
        <div className="mt-4 px-4 py-3 border border-accent-amber/20 bg-accent-amber/5">
          <span className="text-xs font-bold text-accent-amber">
            {backtrackLog.length} backtrack{backtrackLog.length !== 1 ? "s" : ""} performed
          </span>
          <p className="text-xs text-gray-500 mt-1">
            The agent revisited previous pages to test alternative paths
          </p>
        </div>
      )}
    </div>
  );
}
