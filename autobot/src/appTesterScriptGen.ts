/**
 * AI App Tester — Script Generation Variant
 *
 * Cost-optimized alternative to appTester.ts. Instead of an AI agent driving
 * agent-browser in real-time (~30 LLM calls), this approach:
 *
 *   Phase 1: Analyze codebase → TESTER.md              (1 LLM call, reused/cached)
 *   Phase 2: Generate Playwright .ts scripts            (1 LLM call)
 *   Phase 3: Execute scripts with Playwright            (0 LLM calls)
 *   Phase 4: Evaluate results + write report            (1 LLM call)
 *
 * Cost comparison:
 *   Agent-driven:     ~$1.50 (30+ LLM calls for browser interaction)
 *   Script-generated: ~$0.30 (2 LLM calls for generation + evaluation)
 *
 * Benefits:
 *   - Deterministic: same scripts produce same results every run
 *   - Inspectable: you can read the .ts files and see exactly what they test
 *   - Debuggable: run any script individually to reproduce a failure
 *   - Cacheable: scripts can be reused across runs (only regenerate when TESTER.md changes)
 *
 * Usage:
 *   npx tsx src/appTesterScriptGen.ts <url> --codebase <path> [options]
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  parseFlows,
  parseCodeFaults,
  filterFlows,
  groupFlows,
} from "./appTesterPrompts";
import {
  SCRIPT_GEN_SYSTEM_PROMPT,
  EVAL_SYSTEM_PROMPT,
  buildScriptGenPrompt,
  buildEvalPrompt,
} from "./appTesterScriptGenPrompts";

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
  forceScripts: boolean;
  maxBudget: number;
  outputDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const url = args[0];

  if (!url || url.startsWith("--")) {
    console.error(
      "Usage: npx tsx src/appTesterScriptGen.ts <url> --codebase <path> [options]\n\n" +
        "Options:\n" +
        "  --codebase <path>       Path to the codebase to analyze\n" +
        "  --description <text>    Focus testing on specific flows\n" +
        "  --credentials <json>    JSON object with login credentials\n" +
        "  --tester-file <path>    Use existing TESTER.md (skip analysis)\n" +
        "  --force-analysis        Regenerate TESTER.md even if cached\n" +
        "  --force-scripts         Regenerate test scripts even if cached\n" +
        "  --max-budget <usd>      Max spend in USD (default: 5)\n" +
        "  --output-dir <path>     Artifact output directory",
    );
    process.exit(1);
  }

  const result: CliArgs = {
    url,
    forceAnalysis: false,
    forceScripts: false,
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
      case "--force-scripts":
        result.forceScripts = true;
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
        get killed() { return child.killed; },
        get exitCode() { return child.exitCode; },
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
              firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine,
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
        log(opts.phase, `Ended: ${message.subtype}. Cost: $${totalCost.toFixed(4)}`);
        if ("errors" in message) {
          for (const err of message.errors) log(opts.phase, `Error: ${err}`);
        }
      }
    }
  }

  return { result: resultText, cost: totalCost };
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis (reuses existing prompts)               */
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
/*  Phase 2: Generate Playwright scripts from TESTER.md                */
/* ------------------------------------------------------------------ */

async function generateScripts(opts: {
  testerMd: string;
  baseUrl: string;
  description?: string;
  credentials?: Record<string, string>;
  mockEmail: string;
  screenshotDir: string;
  scriptDir: string;
  budget: number;
}): Promise<{
  cost: number;
  scriptFiles: string[];
  groups: ReturnType<typeof groupFlows>;
  allFlows: ReturnType<typeof parseFlows>;
  skippedCount: number;
}> {
  // Parse and filter flows
  const allFlows = parseFlows(opts.testerMd);
  log("Phase 2", `Parsed ${allFlows.length} flows from TESTER.md`);

  if (allFlows.length === 0) {
    throw new Error("No structured flows found in TESTER.md");
  }

  const hasCredentials = Boolean(opts.credentials && Object.keys(opts.credentials).length);
  const filtered = filterFlows(allFlows, hasCredentials, opts.description);
  const skippedCount = allFlows.length - filtered.length;
  if (skippedCount > 0) log("Phase 2", `Filtered out ${skippedCount} flows (auth/description)`);
  log("Phase 2", `Generating scripts for ${filtered.length} flows`);

  // Group flows
  const groups = groupFlows(filtered);
  log("Phase 2", `Organized into ${groups.length} groups:`);
  for (const g of groups) {
    log("Phase 2", `  ${g.groupType}: ${g.groupName} (${g.flows.length} flow${g.flows.length > 1 ? "s" : ""})`);
  }

  // Build the script generation prompt
  const prompt = buildScriptGenPrompt({
    testerMd: opts.testerMd,
    groups,
    baseUrl: opts.baseUrl,
    credentials: opts.credentials,
    mockEmail: opts.mockEmail,
    screenshotDir: opts.screenshotDir,
    scriptDir: opts.scriptDir,
  });

  // Single LLM call to generate all scripts
  log("Phase 2", `Generating ${groups.length} Playwright scripts (1 LLM call)...`);
  const { cost } = await runClaudeQuery({
    prompt,
    systemPrompt: SCRIPT_GEN_SYSTEM_PROMPT,
    cwd: opts.scriptDir,
    tools: ["Write"],
    budget: opts.budget,
    phase: "Phase 2",
  });

  // Discover what scripts were written
  const scriptFiles = fs.existsSync(opts.scriptDir)
    ? fs.readdirSync(opts.scriptDir)
        .filter((f) => f.startsWith("test-") && f.endsWith(".ts"))
        .map((f) => path.join(opts.scriptDir, f))
        .sort()
    : [];

  log("Phase 2", `Generated ${scriptFiles.length} test scripts`);
  for (const f of scriptFiles) {
    log("Phase 2", `  ${path.basename(f)} (${fs.statSync(f).size} bytes)`);
  }

  return { cost, scriptFiles, groups, allFlows, skippedCount };
}

/* ------------------------------------------------------------------ */
/*  Phase 3: Execute Playwright scripts (zero LLM calls)               */
/* ------------------------------------------------------------------ */

interface ScriptResult {
  scriptFile: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  resultFile: string;
}

async function executeScript(
  scriptFile: string,
  baseUrl: string,
  screenshotDir: string,
): Promise<ScriptResult> {
  const basename = path.basename(scriptFile, ".ts");
  const resultFile = path.join(path.dirname(scriptFile), `results-${basename.replace("test-", "")}.json`);

  const startTime = Date.now();

  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      "npx",
      ["tsx", scriptFile, baseUrl, screenshotDir, resultFile],
      {
        cwd: path.dirname(scriptFile),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        timeout: 120_000, // 2 minute hard timeout per script
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      resolve({
        scriptFile,
        exitCode: 1,
        stdout,
        stderr: stderr + `\nSpawn error: ${err.message}`,
        duration: Date.now() - startTime,
        resultFile,
      });
    });

    child.on("exit", (code) => {
      resolve({
        scriptFile,
        exitCode: code ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
        resultFile,
      });
    });
  });
}

async function executeAllScripts(opts: {
  scriptFiles: string[];
  baseUrl: string;
  screenshotDir: string;
}): Promise<ScriptResult[]> {
  const results: ScriptResult[] = [];

  for (const scriptFile of opts.scriptFiles) {
    const scriptName = path.basename(scriptFile);
    log("Phase 3", `Executing: ${scriptName}`);

    const result = await executeScript(scriptFile, opts.baseUrl, opts.screenshotDir);

    const status = result.exitCode === 0 ? "OK" : "FAILED";
    log("Phase 3", `  ${status} (${(result.duration / 1000).toFixed(1)}s, exit ${result.exitCode})`);

    if (result.exitCode !== 0 && result.stderr) {
      // Show last few lines of stderr for debugging
      const errLines = result.stderr.trim().split("\n").slice(-3);
      for (const line of errLines) {
        log("Phase 3", `  stderr: ${line}`);
      }
    }

    // Check if results file was written
    if (fs.existsSync(result.resultFile)) {
      try {
        const flowResults = JSON.parse(fs.readFileSync(result.resultFile, "utf-8"));
        if (Array.isArray(flowResults)) {
          const passed = flowResults.filter((r: { status: string }) => r.status === "pass").length;
          const failed = flowResults.filter((r: { status: string }) => r.status === "fail").length;
          const skipped = flowResults.filter((r: { status: string }) => r.status === "skip").length;
          log("Phase 3", `  Results: ${passed} pass, ${failed} fail, ${skipped} skip`);
        }
      } catch {
        log("Phase 3", `  Warning: Could not parse ${path.basename(result.resultFile)}`);
      }
    } else {
      log("Phase 3", `  Warning: No results file written`);
    }

    results.push(result);
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Phase 4: Evaluate results (1 LLM call)                            */
/* ------------------------------------------------------------------ */

async function evaluateResults(opts: {
  artifactDir: string;
  screenshotDir: string;
  scriptDir: string;
  scriptResults: ScriptResult[];
  codeFaults: string;
  baseUrl: string;
  totalFlows: number;
  skippedFlows: number;
  budget: number;
}): Promise<{ cost: number }> {
  // Collect all result files that exist
  const resultFiles = opts.scriptResults
    .map((r) => r.resultFile)
    .filter((f) => fs.existsSync(f));

  // Also add execution metadata for scripts that failed to write results
  const failedScripts = opts.scriptResults.filter(
    (r) => r.exitCode !== 0 || !fs.existsSync(r.resultFile),
  );

  // Write execution summary for the evaluator
  const execSummaryPath = path.join(opts.scriptDir, "execution-summary.json");
  const execSummary = opts.scriptResults.map((r) => ({
    script: path.basename(r.scriptFile),
    exitCode: r.exitCode,
    duration: r.duration,
    hasResults: fs.existsSync(r.resultFile),
    stderrTail: r.stderr ? r.stderr.trim().split("\n").slice(-5).join("\n") : "",
  }));
  fs.writeFileSync(execSummaryPath, JSON.stringify(execSummary, null, 2));
  resultFiles.push(execSummaryPath);

  log("Phase 4", `Evaluating: ${resultFiles.length} result files, screenshots...`);

  const prompt = buildEvalPrompt({
    artifactDir: opts.artifactDir,
    screenshotDir: opts.screenshotDir,
    scriptDir: opts.scriptDir,
    resultFiles,
    codeFaults: opts.codeFaults,
    baseUrl: opts.baseUrl,
    totalFlows: opts.totalFlows,
    skippedFlows: opts.skippedFlows,
  });

  const { cost } = await runClaudeQuery({
    prompt,
    systemPrompt: EVAL_SYSTEM_PROMPT,
    cwd: opts.artifactDir,
    tools: ["Read", "Write", "Glob"],
    budget: opts.budget,
    phase: "Phase 4",
  });

  return { cost };
}

/* ------------------------------------------------------------------ */
/*  Report collection                                                  */
/* ------------------------------------------------------------------ */

function collectReport(artifactDir: string, screenshotDir: string): void {
  log("Report", "Collecting results...");

  const screenshots = fs.existsSync(screenshotDir)
    ? fs.readdirSync(screenshotDir).filter((f) => f.endsWith(".png"))
    : [];
  log("Report", `Screenshots captured: ${screenshots.length}`);

  const mdReport = path.join(artifactDir, "agent-test-report.md");
  const jsonReport = path.join(artifactDir, "agent-test-report.json");

  if (fs.existsSync(mdReport)) log("Report", `Report: ${mdReport}`);
  else log("Report", "Warning: Markdown report not generated");

  if (fs.existsSync(jsonReport)) {
    log("Report", `JSON: ${jsonReport}`);
    try {
      const r = JSON.parse(fs.readFileSync(jsonReport, "utf-8"));
      log(
        "Report",
        `Status: ${r.status} | Passed: ${r.flowsPassed ?? "?"}/${r.flowsTotal ?? "?"} | ` +
          `Skipped: ${r.flowsSkipped ?? 0} | Faults: ${r.codeFaults ?? 0} | ` +
          `Findings: ${r.findings?.length ?? 0}`,
      );
    } catch {
      log("Report", "Warning: Could not parse JSON report");
    }
  } else {
    log("Report", "Warning: JSON report not generated");
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

  const runId = `scriptgen-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  const scriptDir = path.join(artifactDir, "scripts");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(scriptDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", "═".repeat(60));
  log("Main", "Script-Generation App Tester");
  log("Main", "═".repeat(60));
  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Model: ${CONFIG.agentModel}`);
  log("Main", `Budget: $${cli.maxBudget.toFixed(2)}`);
  log("Main", `Artifacts: ${artifactDir}`);
  log("Main", `Mode: Generate scripts → Execute → Evaluate`);
  log("Main", "─".repeat(60));

  let totalCost = 0;

  // ── Phase 1: Get or generate TESTER.md ──────────────────────────
  let testerMdPath: string;

  if (cli.testerFile) {
    testerMdPath = cli.testerFile;
    if (!fs.existsSync(testerMdPath)) {
      console.error(`Error: --tester-file not found: ${testerMdPath}`);
      process.exit(1);
    }
    log("Phase 1", `Using provided TESTER.md: ${testerMdPath}`);
  } else {
    const repoName = path.basename(cli.codebasePath!);
    testerMdPath = path.join(CONFIG.agentTesterWorkspace, `${repoName}-TESTER.md`);

    if (fs.existsSync(testerMdPath) && !cli.forceAnalysis) {
      log("Phase 1", `Cached TESTER.md: ${testerMdPath}`);
      log("Phase 1", "(--force-analysis to regenerate)");
    } else {
      const result = await runAnalysis(cli.codebasePath!, testerMdPath, cli.maxBudget * 0.3);
      totalCost += result.cost;
    }
  }

  const testerMd = fs.readFileSync(testerMdPath, "utf-8");
  const codeFaults = parseCodeFaults(testerMd);
  const mockEmail = generateMockEmail();

  // Budget allocation for remaining phases
  const remainingBudget = cli.maxBudget - totalCost;
  const scriptGenBudget = remainingBudget * 0.6; // 60% for script generation
  const evalBudget = remainingBudget * 0.4;      // 40% for evaluation

  // ── Phase 2: Generate Playwright scripts ────────────────────────
  log("Main", "─".repeat(60));
  const scriptResult = await generateScripts({
    testerMd,
    baseUrl: cli.url,
    description: cli.description,
    credentials: cli.credentials,
    mockEmail,
    screenshotDir,
    scriptDir,
    budget: scriptGenBudget,
  });
  totalCost += scriptResult.cost;

  if (scriptResult.scriptFiles.length === 0) {
    log("Phase 2", "ERROR: No test scripts were generated");
    process.exit(1);
  }

  // ── Phase 3: Execute scripts (zero LLM cost) ───────────────────
  log("Main", "─".repeat(60));
  log("Phase 3", `Executing ${scriptResult.scriptFiles.length} scripts (no LLM calls)...`);
  const execStartTime = Date.now();

  const execResults = await executeAllScripts({
    scriptFiles: scriptResult.scriptFiles,
    baseUrl: cli.url,
    screenshotDir,
  });

  const execDuration = (Date.now() - execStartTime) / 1000;
  const execPassed = execResults.filter((r) => r.exitCode === 0).length;
  log("Phase 3", `Execution complete: ${execPassed}/${execResults.length} scripts succeeded (${execDuration.toFixed(1)}s)`);
  log("Phase 3", `LLM cost for Phase 3: $0.0000`);

  // ── Phase 4: Evaluate results ──────────────────────────────────
  log("Main", "─".repeat(60));
  const evalResult = await evaluateResults({
    artifactDir,
    screenshotDir,
    scriptDir,
    scriptResults: execResults,
    codeFaults,
    baseUrl: cli.url,
    totalFlows: scriptResult.allFlows.length,
    skippedFlows: scriptResult.skippedCount,
    budget: evalBudget,
  });
  totalCost += evalResult.cost;

  // ── Final report ───────────────────────────────────────────────
  log("Main", "─".repeat(60));
  collectReport(artifactDir, screenshotDir);

  log("Main", "═".repeat(60));
  log("Main", "Cost breakdown:");
  log("Main", `  Phase 1 (Analysis):    $${(totalCost - scriptResult.cost - evalResult.cost).toFixed(4)}`);
  log("Main", `  Phase 2 (Script Gen):  $${scriptResult.cost.toFixed(4)}`);
  log("Main", `  Phase 3 (Execution):   $0.0000`);
  log("Main", `  Phase 4 (Evaluation):  $${evalResult.cost.toFixed(4)}`);
  log("Main", `  Total:                 $${totalCost.toFixed(4)}`);
  log("Main", "═".repeat(60));
  log("Main", `Artifacts: ${artifactDir}`);
  log("Main", `Scripts:   ${scriptDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
