/**
 * AI App Tester — Claude Agent SDK + agent-browser
 *
 * Phase 1: Analyze codebase → find code faults + write structured TESTER.md
 * Phase 2: Parse flows → filter → group → execute each group
 * Phase 3: Aggregate results → write report
 *
 * Flow kinds:
 *   page       — scroll all sections, click all buttons, backtrack after each
 *   navigation — test redirects and links
 *   sequential — multi-step chain (login → dashboard)
 *   rooted     — multiple flows sharing a start page (all dashboard tests together)
 *   api        — curl endpoints, no browser
 *
 * Usage:
 *   npx tsx src/appTester.ts <url> --codebase <path> [options]
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config";
import {
  ANALYSIS_SYSTEM_PROMPT,
  TESTING_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildGroupTestPrompt,
  buildReportPrompt,
  buildTestPrompt,
  parseFlows,
  parseCodeFaults,
  filterFlows,
  groupFlows,
} from "./appTesterPrompts";

/* ------------------------------------------------------------------ */
/*  CLI arg parsing                                                    */
/* ------------------------------------------------------------------ */

interface CliArgs {
  url: string;
  codebasePath?: string;
  description?: string;
  credentials?: Record<string, string>;
  testerFile?: string;
  forceAnalysis: boolean;
  maxBudget: number;
  outputDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const url = args[0];

  if (!url || url.startsWith("--")) {
    console.error(
      "Usage: npx tsx src/appTester.ts <url> --codebase <path> [options]\n\n" +
        "Options:\n" +
        "  --codebase <path>       Path to the codebase to analyze\n" +
        "  --description <text>    Focus testing on specific flows\n" +
        "  --credentials <json>    JSON object with login credentials\n" +
        "  --tester-file <path>    Use existing TESTER.md (skip analysis)\n" +
        "  --force-analysis        Regenerate TESTER.md even if cached\n" +
        "  --max-budget <usd>      Max spend in USD (default: 5)\n" +
        "  --output-dir <path>     Artifact output directory",
    );
    process.exit(1);
  }

  const result: CliArgs = {
    url,
    forceAnalysis: false,
    maxBudget: CONFIG.agentMaxBudgetUsd,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--codebase":
        result.codebasePath = path.resolve(args[++i]);
        break;
      case "--description":
        result.description = args[++i];
        break;
      case "--credentials":
        try {
          result.credentials = JSON.parse(args[++i]);
        } catch {
          console.error("Error: --credentials must be valid JSON");
          process.exit(1);
        }
        break;
      case "--tester-file":
        result.testerFile = path.resolve(args[++i]);
        break;
      case "--force-analysis":
        result.forceAnalysis = true;
        break;
      case "--max-budget":
        result.maxBudget = Number.parseFloat(args[++i]);
        break;
      case "--output-dir":
        result.outputDir = path.resolve(args[++i]);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  if (!result.codebasePath && !result.testerFile) {
    console.error("Error: --codebase or --tester-file is required");
    process.exit(1);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  SDK helpers                                                        */
/* ------------------------------------------------------------------ */

function resolveClaudeCli(): string {
  try {
    return execSync("which claude", { encoding: "utf-8" }).trim();
  } catch {
    throw new Error("Claude Code CLI not found.");
  }
}

function resolveClaudeEntrypoint(): string {
  const cli = resolveClaudeCli();
  const real = fs.realpathSync(cli);
  if (real.endsWith(".js") || real.endsWith(".mjs")) return real;
  return cli;
}

function resolveNodeBin(): string {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return "node";
  }
}

function ensureNodeOnPath(): void {
  const nodeBin = resolveNodeBin();
  const nodeDir = path.dirname(nodeBin);
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.includes(nodeDir)) {
    process.env.PATH = `${nodeDir}:${currentPath}`;
  }
}

function sdkBaseOptions() {
  ensureNodeOnPath();
  const nodeBin = resolveNodeBin();
  const entrypoint = resolveClaudeEntrypoint();
  return {
    pathToClaudeCodeExecutable: entrypoint,
    spawnClaudeCodeProcess: (opts: {
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string | undefined>;
      signal?: AbortSignal;
    }) => {
      const cmd = opts.command === "node" ? nodeBin : opts.command;
      const child = spawn(cmd, opts.args, {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        signal: opts.signal,
        env: opts.env as NodeJS.ProcessEnv,
        windowsHide: true,
      });
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        get killed() {
          return child.killed;
        },
        get exitCode() {
          return child.exitCode;
        },
        kill: child.kill.bind(child),
        on: child.on.bind(child),
        once: child.once.bind(child),
        off: child.off.bind(child),
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

function generateMockEmail(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString("hex");
  return `test-${ts}-${rand}@autobot-test.com`;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function log(phase: string, message: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [${phase}] ${message}`);
}

/* ------------------------------------------------------------------ */
/*  Run a Claude Agent SDK query                                       */
/* ------------------------------------------------------------------ */

async function runClaudeQuery(opts: {
  prompt: string;
  systemPrompt: string;
  cwd: string;
  tools: string[];
  budget: number;
  phase: string;
  verbose?: boolean;
}): Promise<{ result: string; cost: number }> {
  const base = sdkBaseOptions();
  let totalCost = 0;
  let resultText = "";

  const response = query({
    prompt: opts.prompt,
    options: {
      ...base,
      model: CONFIG.agentModel,
      cwd: opts.cwd,
      allowedTools: opts.tools,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: opts.budget,
      systemPrompt: opts.systemPrompt,
    },
  });

  for await (const message of response) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          const text = block.text.trim();
          resultText += text + "\n";
          if (opts.verbose !== false) {
            const firstLine = text.split("\n")[0];
            log(
              opts.phase,
              firstLine.length > 120
                ? `${firstLine.slice(0, 117)}...`
                : firstLine,
            );
          }
        }
      }
    } else if (message.type === "result") {
      totalCost = message.total_cost_usd;
      if (message.subtype === "success") {
        resultText = message.result;
        log(opts.phase, `Done. Cost: $${totalCost.toFixed(4)}`);
      } else {
        log(
          opts.phase,
          `Ended: ${message.subtype}. Cost: $${totalCost.toFixed(4)}`,
        );
        if ("errors" in message) {
          for (const err of message.errors) log(opts.phase, `Error: ${err}`);
        }
      }
    }
  }

  return { result: resultText, cost: totalCost };
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis + Code Faults                           */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
  budget: number,
): Promise<{ cost: number }> {
  log("Phase 1", "Analyzing codebase + finding code faults...");
  log("Phase 1", `Codebase: ${codebasePath}`);
  log("Phase 1", `Output: ${testerMdPath}`);
  log("Phase 1", `Budget: $${budget.toFixed(2)}`);

  const { cost } = await runClaudeQuery({
    prompt: buildAnalysisPrompt(testerMdPath),
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    cwd: codebasePath,
    tools: ["Read", "Glob", "Grep", "Write", "Bash"],
    budget,
    phase: "Phase 1",
  });

  if (!fs.existsSync(testerMdPath)) {
    throw new Error(`Phase 1 failed: TESTER.md not written to ${testerMdPath}`);
  }

  log("Phase 1", `TESTER.md saved (${fs.statSync(testerMdPath).size} bytes)`);
  return { cost };
}

/* ------------------------------------------------------------------ */
/*  Phase 2: Grouped Test Execution                                    */
/* ------------------------------------------------------------------ */

async function runGroupedTests(opts: {
  baseUrl: string;
  testerMd: string;
  description?: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  artifactDir: string;
  mockEmail: string;
  budget: number;
}): Promise<{ cost: number }> {
  // Step 1: Parse flows
  const allFlows = parseFlows(opts.testerMd);
  const codeFaults = parseCodeFaults(opts.testerMd);
  log("Phase 2", `Parsed ${allFlows.length} flows from TESTER.md`);

  if (codeFaults) {
    const faultLines =
      codeFaults.split("\n").filter((l) => l.includes("|")).length - 2; // minus header rows
    log("Phase 2", `Code faults found: ${Math.max(0, faultLines)}`);
  }

  if (allFlows.length === 0) {
    log("Phase 2", "No structured flows found — falling back to legacy mode");
    return runLegacyTests(opts);
  }

  // Step 2: Filter
  const hasCredentials = Boolean(
    opts.credentials && Object.keys(opts.credentials).length,
  );
  const filtered = filterFlows(allFlows, hasCredentials, opts.description);
  const skippedCount = allFlows.length - filtered.length;
  if (skippedCount > 0)
    log("Phase 2", `Filtered out ${skippedCount} flows (auth required)`);
  log("Phase 2", `Testing ${filtered.length} flows`);

  // Step 3: Group
  const groups = groupFlows(filtered);
  log("Phase 2", `Organized into ${groups.length} groups:`);
  for (const g of groups) {
    log(
      "Phase 2",
      `  ${g.groupType}: ${g.groupName} (${g.flows.length} flow${g.flows.length > 1 ? "s" : ""})`,
    );
  }

  // Step 4: Execute each group
  const testBudget = opts.budget * 0.85; // 85% for testing
  const reportBudget = opts.budget * 0.15; // 15% for report
  const budgetPerGroup = testBudget / groups.length;
  let totalCost = 0;
  const groupResults: Array<{ groupName: string; output: string }> = [];

  // Init browser
  log("Phase 2", "\nOpening browser...");
  const initResult = await runClaudeQuery({
    prompt: `Run: agent-browser open ${opts.baseUrl} && agent-browser wait --load networkidle && echo "Browser ready"`,
    systemPrompt: "Open the browser.",
    cwd: opts.artifactDir,
    tools: ["Bash"],
    budget: budgetPerGroup * 0.1,
    phase: "Init",
    verbose: false,
  });
  totalCost += initResult.cost;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    log(
      "Phase 2",
      `\n--- Group ${i + 1}/${groups.length}: ${group.groupName} ---`,
    );

    const prompt = buildGroupTestPrompt({
      baseUrl: opts.baseUrl,
      group,
      codeFaults,
      credentials: opts.credentials,
      screenshotDir: opts.screenshotDir,
      mockEmail: opts.mockEmail,
      groupIndex: i,
      totalGroups: groups.length,
    });

    const { result, cost } = await runClaudeQuery({
      prompt,
      systemPrompt: TESTING_SYSTEM_PROMPT,
      cwd: opts.artifactDir,
      tools: ["Bash", "Read", "Write"],
      budget: budgetPerGroup,
      phase: `Group ${i + 1}`,
    });

    totalCost += cost;
    groupResults.push({ groupName: group.groupName, output: result });
  }

  // Close browser
  log("Phase 2", "\nClosing browser...");
  const closeResult = await runClaudeQuery({
    prompt: "Run: agent-browser close",
    systemPrompt: "Close browser.",
    cwd: opts.artifactDir,
    tools: ["Bash"],
    budget: budgetPerGroup * 0.05,
    phase: "Cleanup",
    verbose: false,
  });
  totalCost += closeResult.cost;

  // Step 5: Aggregate report
  log("Phase 2", "\nWriting report...");
  const reportResult = await runClaudeQuery({
    prompt: buildReportPrompt({
      artifactDir: opts.artifactDir,
      groupResults,
      codeFaults,
      baseUrl: opts.baseUrl,
      totalFlows: allFlows.length,
      skippedFlows: skippedCount,
    }),
    systemPrompt: "Write clear, structured test reports.",
    cwd: opts.artifactDir,
    tools: ["Write"],
    budget: reportBudget,
    phase: "Report",
  });
  totalCost += reportResult.cost;

  return { cost: totalCost };
}

async function runLegacyTests(opts: {
  baseUrl: string;
  testerMd: string;
  description?: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  artifactDir: string;
  mockEmail: string;
  budget: number;
}): Promise<{ cost: number }> {
  log("Phase 2", "Running legacy single-prompt mode...");
  const { cost } = await runClaudeQuery({
    prompt: buildTestPrompt({
      baseUrl: opts.baseUrl,
      testerMd: opts.testerMd,
      description: opts.description,
      credentials: opts.credentials,
      screenshotDir: opts.screenshotDir,
      artifactDir: opts.artifactDir,
      mockEmail: opts.mockEmail,
    }),
    systemPrompt: TESTING_SYSTEM_PROMPT,
    cwd: opts.artifactDir,
    tools: ["Bash", "Read", "Write"],
    budget: opts.budget,
    phase: "Phase 2",
  });
  return { cost };
}

/* ------------------------------------------------------------------ */
/*  Phase 3: Report Collection                                         */
/* ------------------------------------------------------------------ */

function collectReport(artifactDir: string, screenshotDir: string): void {
  log("Phase 3", "Collecting results...");

  const screenshots = fs.existsSync(screenshotDir)
    ? fs.readdirSync(screenshotDir).filter((f) => f.endsWith(".png"))
    : [];
  log("Phase 3", `Screenshots captured: ${screenshots.length}`);

  const mdReport = path.join(artifactDir, "agent-test-report.md");
  const jsonReport = path.join(artifactDir, "agent-test-report.json");

  if (fs.existsSync(mdReport)) log("Phase 3", `Report: ${mdReport}`);
  else log("Phase 3", "Warning: Markdown report not generated");

  if (fs.existsSync(jsonReport)) {
    log("Phase 3", `JSON: ${jsonReport}`);
    try {
      const r = JSON.parse(fs.readFileSync(jsonReport, "utf-8"));
      log(
        "Phase 3",
        `Status: ${r.status} | Passed: ${r.flowsPassed ?? "?"}/${r.flowsTotal ?? "?"} | Skipped: ${r.flowsSkipped ?? 0} | Faults: ${r.codeFaults ?? 0} | Findings: ${r.findings?.length ?? 0}`,
      );
    } catch {
      log("Phase 3", "Warning: Could not parse JSON report");
    }
  } else {
    log("Phase 3", "Warning: JSON report not generated");
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);

  if (!CONFIG.anthropicApiKey) {
    console.error("Error: ANTHROPIC_API_KEY not set. Add to autobot/.env");
    process.exit(1);
  }

  const runId = `app-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Model: ${CONFIG.agentModel}`);
  log("Main", `Budget: $${cli.maxBudget.toFixed(2)}`);
  log("Main", `Artifacts: ${artifactDir}`);

  let testerMdPath: string;
  let phase1Cost = 0;

  if (cli.testerFile) {
    testerMdPath = cli.testerFile;
    if (!fs.existsSync(testerMdPath)) {
      console.error(`Error: --tester-file not found: ${testerMdPath}`);
      process.exit(1);
    }
    log("Main", `Using provided TESTER.md: ${testerMdPath}`);
  } else {
    const repoName = path.basename(cli.codebasePath!);
    testerMdPath = path.join(
      CONFIG.agentTesterWorkspace,
      `${repoName}-TESTER.md`,
    );

    if (fs.existsSync(testerMdPath) && !cli.forceAnalysis) {
      log("Main", `Cached TESTER.md: ${testerMdPath}`);
      log("Main", "(--force-analysis to regenerate)");
    } else {
      const result = await runAnalysis(
        cli.codebasePath!,
        testerMdPath,
        cli.maxBudget * 0.3,
      );
      phase1Cost = result.cost;
    }
  }

  const testerMd = fs.readFileSync(testerMdPath, "utf-8");
  const mockEmail = generateMockEmail();
  const testBudget = cli.maxBudget - phase1Cost;

  const testResult = await runGroupedTests({
    baseUrl: cli.url,
    testerMd,
    description: cli.description,
    credentials: cli.credentials,
    screenshotDir,
    artifactDir,
    mockEmail,
    budget: Math.max(testBudget, cli.maxBudget * 0.5),
  });

  collectReport(artifactDir, screenshotDir);

  const totalCost = phase1Cost + testResult.cost;
  log("Main", "\u2500".repeat(50));
  log("Main", `Done. Total cost: $${totalCost.toFixed(4)}`);
  log("Main", `Artifacts: ${artifactDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
