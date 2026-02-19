/**
 * AI App Tester — Plandex CLI + agent-browser + DeepSeek V3.2
 *
 * Same goal as appTester.ts (Claude variant) but uses Plandex CLI
 * with DeepSeek as the model provider.
 *
 * Plandex is a plan-based coding agent with client-server architecture.
 * It supports auto-execution of shell commands via --auto-exec flag.
 *
 * Prerequisites:
 *   - plandex CLI installed: https://docs.plandex.ai/install
 *   - plandex server running (cloud or self-hosted)
 *   - DEEPSEEK_API_KEY set for DeepSeek model
 *   - PLANDEX_API_KEY set (if using cloud server)
 *
 * Usage:
 *   npx tsx src/appTesterPlandex.ts <url> --codebase <path> [options]
 */

import { execSync, spawn as nodeSpawn, type ChildProcess } from "node:child_process";
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

const DEEPSEEK_MODEL = "deepseek/deepseek-chat";

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
      "Usage: npx tsx src/appTesterPlandex.ts <url> --codebase <path> [options]\n\n" +
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

function verifyPlandexCli(): void {
  try {
    execSync("which plandex", { encoding: "utf-8" });
  } catch {
    throw new Error(
      "Plandex CLI not found. Install it:\n" +
        "  curl -sL https://plandex.ai/install.sh | bash\n" +
        "See: https://docs.plandex.ai/install",
    );
  }
}

function verifyDeepSeekApiKey(): void {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Export it or add to autobot/.env\n" +
        "Get a key at: https://platform.deepseek.com/",
    );
  }
}

/**
 * Run a Plandex command and capture output.
 *
 * Plandex workflow:
 *   1. plandex new "plan-name" — create a new plan
 *   2. plandex set-model ... — configure model
 *   3. plandex load <files> — add context
 *   4. plandex tell "prompt" --full --apply --auto-exec — execute
 */
function runPlandexCmd(
  args: string[],
  cwd: string,
  phase: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = nodeSpawn("plandex", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      for (const line of text.trim().split("\n")) {
        if (line.trim()) log(phase, line.trim());
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (text.trim()) log(phase, `[stderr] ${text.trim()}`);
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Plandex exited with code ${code}\n${stderr}`));
    });
  });
}

/**
 * Run Plandex tell with a prompt and auto-apply + auto-exec.
 */
async function plandexTell(opts: {
  prompt: string;
  cwd: string;
  phase: string;
}): Promise<void> {
  await runPlandexCmd(
    ["tell", opts.prompt, "--no-build", "--auto-exec"],
    opts.cwd,
    opts.phase,
  );
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis                                         */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
): Promise<void> {
  log("Phase 1", "Analyzing codebase with Plandex + DeepSeek...");
  log("Phase 1", `Codebase: ${codebasePath}`);
  log("Phase 1", `TESTER.md will be written to: ${testerMdPath}`);

  // Create a new Plandex plan for this analysis
  const planName = `app-test-analysis-${Date.now()}`;
  try {
    await runPlandexCmd(["new", planName], codebasePath, "Phase 1 (setup)");
  } catch {
    // Plan might already exist or server might not be running
    log("Phase 1", "Warning: Could not create Plandex plan. Attempting to continue...");
  }

  // Configure DeepSeek model
  try {
    await runPlandexCmd(
      ["set-model", "planner", DEEPSEEK_MODEL],
      codebasePath,
      "Phase 1 (model)",
    );
    await runPlandexCmd(
      ["set-model", "coder", DEEPSEEK_MODEL],
      codebasePath,
      "Phase 1 (model)",
    );
  } catch {
    log("Phase 1", "Warning: Could not set model. Using default.");
  }

  const prompt =
    `${ANALYSIS_SYSTEM_PROMPT}\n\n${buildAnalysisPrompt(testerMdPath)}\n\n` +
    `Write the complete TESTER.md file to: ${testerMdPath}\n` +
    `Read through all the source files in the project first, then produce the test plan.`;

  await plandexTell({
    prompt,
    cwd: codebasePath,
    phase: "Phase 1",
  });

  if (!fs.existsSync(testerMdPath)) {
    throw new Error(`Phase 1 failed: TESTER.md was not written to ${testerMdPath}`);
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
  log("Phase 2", "Testing app with Plandex + agent-browser...");
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

  // Create a new Plandex plan for testing
  const planName = `app-test-run-${Date.now()}`;
  try {
    await runPlandexCmd(["new", planName], opts.artifactDir, "Phase 2 (setup)");
  } catch {
    log("Phase 2", "Warning: Could not create Plandex plan. Attempting to continue...");
  }

  // Configure DeepSeek model for testing
  try {
    await runPlandexCmd(
      ["set-model", "planner", DEEPSEEK_MODEL],
      opts.artifactDir,
      "Phase 2 (model)",
    );
    await runPlandexCmd(
      ["set-model", "coder", DEEPSEEK_MODEL],
      opts.artifactDir,
      "Phase 2 (model)",
    );
  } catch {
    log("Phase 2", "Warning: Could not set model. Using default.");
  }

  const prompt = `${TESTING_SYSTEM_PROMPT}\n\n${testPromptBody}\n\n` +
    `IMPORTANT: Execute all agent-browser commands using shell execution.\n` +
    `Run each command one at a time, check the output, then proceed.\n` +
    `After all tests, write the report files as specified above.`;

  await plandexTell({
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
      log("Phase 3", `Status: ${report.status} | Flows: ${report.flowsPassed ?? "?"}/${report.flowsTotal ?? "?"} passed | Findings: ${report.findings?.length ?? 0}`);
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
  verifyPlandexCli();
  verifyDeepSeekApiKey();

  const runId = `plandex-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Agent: Plandex + DeepSeek (${DEEPSEEK_MODEL})`);
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
    testerMdPath = path.join(CONFIG.agentTesterWorkspace, `${repoName}-TESTER.md`);

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
