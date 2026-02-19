/**
 * AI App Tester — Aider CLI + agent-browser + DeepSeek V3.2
 *
 * Same goal as appTester.ts (Claude variant) but uses Aider CLI
 * with DeepSeek as the model provider.
 *
 * IMPORTANT: Aider is primarily a code-editing tool and cannot auto-execute
 * shell commands in automated mode. For Phase 2 (browser testing), we use
 * Aider's /run command capability by writing a helper script that Aider
 * can invoke, or we fall back to direct agent-browser orchestration
 * via a subprocess loop.
 *
 * Usage:
 *   npx tsx src/appTesterAider.ts <url> --codebase <path> [options]
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
      "Usage: npx tsx src/appTesterAider.ts <url> --codebase <path> [options]\n\n" +
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

/** Resolve the aider binary, adding common Python bin dirs to PATH if needed. */
function resolveAiderBin(): string {
  // Common locations for pip-installed scripts on macOS
  const pythonBinDirs = [
    path.join(process.env.HOME ?? "", "Library", "Python", "3.10", "bin"),
    path.join(process.env.HOME ?? "", "Library", "Python", "3.11", "bin"),
    path.join(process.env.HOME ?? "", "Library", "Python", "3.12", "bin"),
    path.join(process.env.HOME ?? "", ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  // Ensure these are on PATH for this process and child processes
  const currentPath = process.env.PATH ?? "";
  const missing = pythonBinDirs.filter(
    (d) => !currentPath.includes(d) && fs.existsSync(d),
  );
  if (missing.length) {
    process.env.PATH = `${missing.join(":")}:${currentPath}`;
  }

  try {
    return execSync("which aider", { encoding: "utf-8" }).trim();
  } catch {
    // Direct check in known locations
    for (const dir of pythonBinDirs) {
      const candidate = path.join(dir, "aider");
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
      "Aider CLI not found. Install it: pip install aider-chat\n" +
        "See: https://aider.chat/docs/install.html",
    );
  }
}

let aiderBin = "aider";

function verifyAiderCli(): void {
  aiderBin = resolveAiderBin();
  log("Main", `Aider binary: ${aiderBin}`);
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
 * Run Aider with a message prompt.
 *
 * Aider flags:
 *   --model deepseek/deepseek-chat — use DeepSeek model
 *   --yes — auto-confirm all prompts
 *   --no-auto-commits — don't git commit changes
 *   --no-pretty — plain output (no terminal formatting)
 *   --no-stream — wait for full response (more reliable in scripts)
 *   --message "..." — the task to perform
 *   --file <path> — add files to Aider's context
 *   --no-git — don't require git repo
 */
function runAider(opts: {
  message: string;
  cwd: string;
  phase: string;
  files?: string[];
  allowExecution?: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const aiderArgs = [
      "--model",
      DEEPSEEK_MODEL,
      "--yes",
      "--no-auto-commits",
      "--no-pretty",
      "--no-stream",
      "--no-git",
      "--message",
      opts.message,
    ];

    // Add specific files to context if provided
    if (opts.files) {
      for (const f of opts.files) {
        aiderArgs.push("--file", f);
      }
    }

    const child: ChildProcess = nodeSpawn(aiderBin, aiderArgs, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      for (const line of text.trim().split("\n")) {
        if (line.trim()) log(opts.phase, line.trim());
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      if (text.trim()) log(opts.phase, `[stderr] ${text.trim()}`);
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Aider exited with code ${code}\n${stderr}`));
    });
  });
}

/**
 * Run an agent-browser command directly via shell.
 * Used in Phase 2 since Aider can't auto-execute shell commands.
 */
function runBrowserCmd(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn("sh", ["-c", cmd], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `agent-browser command failed (${code}): ${cmd}\n${stderr}`,
          ),
        );
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis                                         */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
): Promise<void> {
  log("Phase 1", "Analyzing codebase with Aider + DeepSeek...");
  log("Phase 1", `Codebase: ${codebasePath}`);
  log("Phase 1", `TESTER.md will be written to: ${testerMdPath}`);

  // Aider excels at code analysis — it can read files and write new ones.
  // We ask it to analyze the codebase and produce a TESTER.md file.
  const prompt =
    `${ANALYSIS_SYSTEM_PROMPT}\n\n${buildAnalysisPrompt(testerMdPath)}\n\n` +
    `IMPORTANT: Write the TESTER.md file to exactly this path: ${testerMdPath}\n` +
    `Create the directory if it doesn't exist. Use the /write command or create the file directly.`;

  await runAider({
    message: prompt,
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
/*                                                                     */
/*  Aider cannot auto-execute shell commands, so we use a hybrid       */
/*  approach: Aider generates a test script from the TESTER.md, then   */
/*  we execute agent-browser commands directly from TypeScript.         */
/*  Alternatively, Aider writes a bash test script that we execute.    */
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
  log("Phase 2", "Testing app with Aider + agent-browser...");
  log("Phase 2", `URL: ${opts.baseUrl}`);

  // Step 1: Have Aider generate a bash test script from the TESTER.md
  const testScriptPath = path.join(opts.artifactDir, "run-tests.sh");

  const scriptGenPrompt = `You are an expert QA tester. Based on the test plan below, generate a comprehensive
bash test script that uses agent-browser CLI commands to test the web application.

The script should:
1. Open ${opts.baseUrl} with agent-browser
2. Execute each test flow step by step
3. Take screenshots at key moments (save to ${opts.screenshotDir}/)
4. Use numbered descriptive names: 001-landing-page.png, 002-signup-form.png, etc.
5. After all tests, write results to ${opts.artifactDir}/agent-test-report.md
6. Also write a JSON report to ${opts.artifactDir}/agent-test-report.json

${opts.credentials ? `Use these credentials:\n${JSON.stringify(opts.credentials, null, 2)}` : `No credentials. Create account with:\n  Email: ${opts.mockEmail}\n  Password: TestPass123!\n  Name: Test User`}

${opts.description ? `Focus on: ${opts.description}` : "Test all major flows."}

## agent-browser commands available:
- agent-browser open <url>
- agent-browser snapshot -i  (get interactive elements with @e1, @e2 refs)
- agent-browser fill @eN "value"
- agent-browser click @eN
- agent-browser screenshot <path>
- agent-browser get text @eN
- agent-browser get url
- agent-browser wait --load networkidle
- agent-browser find text "..." click
- agent-browser close

## IMPORTANT:
- Always run \`agent-browser snapshot -i\` before any fill/click to get fresh refs
- After navigation or form submit, wait and re-snapshot
- The script must be executable bash (#!/usr/bin/env bash, set -euo pipefail)
- Use || true after non-critical commands to prevent script abort on minor failures
- Parse snapshot output to find correct refs for elements

## Test Plan:
${opts.testerMd}

Write the complete bash script to: ${testScriptPath}
Make it executable (chmod +x).`;

  await runAider({
    message: scriptGenPrompt,
    cwd: opts.artifactDir,
    phase: "Phase 2 (script gen)",
  });

  // Step 2: Execute the generated test script
  if (fs.existsSync(testScriptPath)) {
    log("Phase 2", `Executing generated test script: ${testScriptPath}`);
    try {
      fs.chmodSync(testScriptPath, "755");
      const output = await runBrowserCmd(
        `bash "${testScriptPath}"`,
        opts.artifactDir,
      );
      log("Phase 2", "Test script completed");
      if (output) {
        for (const line of output.split("\n").slice(-20)) {
          if (line.trim()) log("Phase 2", line.trim());
        }
      }
    } catch (err) {
      log(
        "Phase 2",
        `Test script failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Don't throw — we still want to collect partial results
    }
  } else {
    // Fallback: Aider didn't write the script, try to run tests inline
    log(
      "Phase 2",
      "Warning: Aider did not generate test script. Running basic smoke test...",
    );
    try {
      await runBrowserCmd(
        `agent-browser open ${opts.baseUrl}`,
        opts.artifactDir,
      );
      await runBrowserCmd(
        "agent-browser wait --load networkidle",
        opts.artifactDir,
      );
      await runBrowserCmd(
        `agent-browser screenshot "${path.join(opts.screenshotDir, "001-landing-page.png")}"`,
        opts.artifactDir,
      );
      const snapshot = await runBrowserCmd(
        "agent-browser snapshot -i",
        opts.artifactDir,
      );
      log("Phase 2", "Landing page snapshot captured");

      // Write a minimal report
      const report =
        `# Agent Test Report (Aider - Fallback Mode)\n\n` +
        `Aider could not generate a full test script. Only basic smoke test was run.\n\n` +
        `## Landing Page\n\nSnapshot:\n\`\`\`\n${snapshot.slice(0, 2000)}\n\`\`\`\n`;
      fs.writeFileSync(
        path.join(opts.artifactDir, "agent-test-report.md"),
        report,
      );
      fs.writeFileSync(
        path.join(opts.artifactDir, "agent-test-report.json"),
        JSON.stringify(
          {
            status: "partial",
            flowsTotal: 1,
            flowsPassed: 1,
            flowsFailed: 0,
            findings: [],
            routesTested: [opts.baseUrl],
            summary: "Only basic smoke test was run — Aider fallback mode.",
          },
          null,
          2,
        ),
      );

      await runBrowserCmd("agent-browser close", opts.artifactDir);
    } catch (err) {
      log(
        "Phase 2",
        `Fallback smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
  verifyAiderCli();
  verifyDeepSeekApiKey();

  const runId = `aider-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Agent: Aider + DeepSeek (${DEEPSEEK_MODEL})`);
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
