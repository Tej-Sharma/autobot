/**
 * AI App Tester — Gemini CLI + agent-browser + Gemini 3 Flash
 *
 * Same goal as appTester.ts (Claude variant) but uses Google's Gemini CLI
 * with Gemini 3 Flash as the model.
 *
 * Prerequisites:
 *   - npm install -g @google/gemini-cli
 *   - Google AI Studio API key (free): https://aistudio.google.com/apikey
 *   - GEMINI_API_KEY or login via `gemini` interactive mode first
 *   - agent-browser installed: npm install -g agent-browser && agent-browser install
 *
 * Usage:
 *   npx tsx src/appTesterGemini.ts <url> --codebase <path> [options]
 */

import {
  execSync,
  spawn as nodeSpawn,
  type ChildProcess,
} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config";
import {
  ANALYSIS_SYSTEM_PROMPT,
  TESTING_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildTestPrompt,
} from "./appTesterPrompts";

const GEMINI_MODEL = "flash"; // maps to gemini-3-flash-preview

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
  outputDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const url = args[0];

  if (!url || url.startsWith("--")) {
    console.error(
      "Usage: npx tsx src/appTesterGemini.ts <url> --codebase <path> [options]\n\n" +
        "Options:\n" +
        "  --codebase <path>       Path to the codebase to analyze\n" +
        "  --description <text>    Focus testing on specific flows\n" +
        "  --credentials <json>    JSON object with login credentials\n" +
        "  --tester-file <path>    Use existing TESTER.md (skip analysis)\n" +
        "  --force-analysis        Regenerate TESTER.md even if cached\n" +
        "  --output-dir <path>     Artifact output directory",
    );
    process.exit(1);
  }

  const result: CliArgs = { url, forceAnalysis: false };

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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateMockEmail(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(3).toString("hex");
  return `test-${ts}-${rand}@autobot-test.com`;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function log(phase: string, message: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [${phase}] ${message}`);
}

function verifyGeminiCli(): void {
  try {
    execSync("which gemini", { encoding: "utf-8" });
  } catch {
    throw new Error(
      "Gemini CLI not found. Install it: npm install -g @google/gemini-cli\n" +
        "Then authenticate: gemini (interactive mode, login with Google)",
    );
  }
}

/** Token usage stats returned by Gemini CLI JSON output */
interface GeminiStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
}

interface GeminiRunResult {
  response: string;
  stats: GeminiStats;
}

/**
 * Run Gemini CLI in headless mode with yolo (auto-approve all actions).
 *
 * Uses --output-format json to get structured output with token stats.
 * JSON output shape: { response: string, stats: { inputTokens, outputTokens, ... }, error?: string }
 *
 * Gemini CLI flags:
 *   --model flash              Use Gemini 3 Flash
 *   --approval-mode yolo       Auto-approve all file writes and shell commands
 *   --output-format json       Structured output with stats
 *   <prompt>                   Positional arg triggers headless mode
 */
function runGemini(opts: {
  prompt: string;
  cwd: string;
  phase: string;
}): Promise<GeminiRunResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = nodeSpawn(
      "gemini",
      [
        "--model",
        GEMINI_MODEL,
        "--approval-mode",
        "yolo",
        "--output-format",
        "json",
        opts.prompt,
      ],
      {
        cwd: opts.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Stderr contains live progress — log it
      for (const line of text.trim().split("\n")) {
        if (line.trim()) log(opts.phase, line.trim());
      }
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      // Parse JSON output for response + stats
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // If JSON parsing fails, treat stdout as plain text
        if (code === 0) {
          log(opts.phase, "(output was not valid JSON — using raw text)");
        }
      }

      const response =
        typeof parsed.response === "string" ? parsed.response : stdout;
      const rawStats = (parsed.stats ?? {}) as Record<string, unknown>;
      const stats: GeminiStats = {
        inputTokens:
          typeof rawStats.inputTokens === "number"
            ? rawStats.inputTokens
            : undefined,
        outputTokens:
          typeof rawStats.outputTokens === "number"
            ? rawStats.outputTokens
            : undefined,
        totalTokens:
          typeof rawStats.totalTokens === "number"
            ? rawStats.totalTokens
            : undefined,
        latencyMs:
          typeof rawStats.latencyMs === "number"
            ? rawStats.latencyMs
            : undefined,
      };

      // Log the response text
      if (response && response !== stdout) {
        for (const line of response.trim().split("\n").slice(0, 30)) {
          if (line.trim()) log(opts.phase, line.trim());
        }
        if (response.trim().split("\n").length > 30) {
          log(
            opts.phase,
            `... (${response.trim().split("\n").length - 30} more lines)`,
          );
        }
      }

      if (code === 0) resolve({ response, stats });
      else reject(new Error(`Gemini CLI exited with code ${code}\n${stderr}`));
    });
  });
}

/** Estimate cost from Gemini token usage (Gemini 3 Flash pricing). */
function estimateGeminiCost(stats: GeminiStats): number {
  // Gemini 3 Flash pricing (as of Feb 2026):
  // Input: $0.10 per 1M tokens, Output: $0.40 per 1M tokens
  const inputCost = ((stats.inputTokens ?? 0) / 1_000_000) * 0.1;
  const outputCost = ((stats.outputTokens ?? 0) / 1_000_000) * 0.4;
  return inputCost + outputCost;
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis                                         */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
): Promise<void> {
  log("Phase 1", "Analyzing codebase with Gemini CLI (Gemini 3 Flash)...");
  log("Phase 1", `Codebase: ${codebasePath}`);
  log("Phase 1", `TESTER.md will be written to: ${testerMdPath}`);

  const prompt = `${ANALYSIS_SYSTEM_PROMPT}\n\n${buildAnalysisPrompt(testerMdPath)}`;

  await runGemini({
    prompt,
    cwd: codebasePath,
    phase: "Phase 1",
  });

  if (!fs.existsSync(testerMdPath)) {
    throw new Error(
      `Phase 1 failed: TESTER.md was not written to ${testerMdPath}`,
    );
  }

  log("Phase 1", `TESTER.md saved (${fs.statSync(testerMdPath).size} bytes)`);
}

/* ------------------------------------------------------------------ */
/*  Phase 2: Test Execution                                            */
/* ------------------------------------------------------------------ */

async function runTests(opts: {
  baseUrl: string;
  testerMd: string;
  description?: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  artifactDir: string;
  mockEmail: string;
}): Promise<void> {
  log("Phase 2", "Testing app with Gemini CLI + agent-browser...");
  log("Phase 2", `URL: ${opts.baseUrl}`);

  const testPromptBody = buildTestPrompt({
    baseUrl: opts.baseUrl,
    testerMd: opts.testerMd,
    description: opts.description,
    credentials: opts.credentials,
    screenshotDir: opts.screenshotDir,
    artifactDir: opts.artifactDir,
    mockEmail: opts.mockEmail,
  });

  const prompt = `${TESTING_SYSTEM_PROMPT}\n\n${testPromptBody}`;

  await runGemini({
    prompt,
    cwd: opts.artifactDir,
    phase: "Phase 2",
  });
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

  if (fs.existsSync(mdReport)) log("Phase 3", `Markdown report: ${mdReport}`);
  else log("Phase 3", "Warning: Markdown report was not generated");

  if (fs.existsSync(jsonReport)) {
    log("Phase 3", `JSON report: ${jsonReport}`);
    try {
      const report = JSON.parse(fs.readFileSync(jsonReport, "utf-8"));
      log(
        "Phase 3",
        `Status: ${report.status} | Flows: ${report.flowsPassed ?? "?"}/${report.flowsTotal ?? "?"} passed | Findings: ${report.findings?.length ?? 0}`,
      );
    } catch {
      log("Phase 3", "Warning: Could not parse JSON report");
    }
  } else {
    log("Phase 3", "Warning: JSON report was not generated");
  }
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const cli = parseArgs(process.argv);
  verifyGeminiCli();

  const runId = `gemini-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Agent: Gemini CLI (Gemini 3 Flash)`);
  log("Main", `Artifacts: ${artifactDir}`);

  let testerMdPath: string;

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
      log("Main", `Using cached TESTER.md: ${testerMdPath}`);
    } else {
      await runAnalysis(cli.codebasePath!, testerMdPath);
    }
  }

  const testerMd = fs.readFileSync(testerMdPath, "utf-8");
  const mockEmail = generateMockEmail();

  await runTests({
    baseUrl: cli.url,
    testerMd,
    description: cli.description,
    credentials: cli.credentials,
    screenshotDir,
    artifactDir,
    mockEmail,
  });

  collectReport(artifactDir, screenshotDir);

  log("Main", "\u2500".repeat(50));
  log("Main", `Done. Artifacts: ${artifactDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
