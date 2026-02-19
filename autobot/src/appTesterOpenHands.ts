/**
 * AI App Tester — OpenHands + agent-browser + DeepSeek V3.2
 *
 * Same goal as appTester.ts (Claude variant) but uses OpenHands
 * (formerly OpenDevin) with DeepSeek as the model provider.
 *
 * OpenHands is a Docker-based coding agent that supports headless mode
 * and has built-in browser capabilities. We use its headless CLI mode
 * and configure it to use agent-browser for testing.
 *
 * Prerequisites:
 *   - Docker installed and running
 *   - OpenHands Docker image: docker pull ghcr.io/all-hands-ai/openhands:latest
 *   - DEEPSEEK_API_KEY set for DeepSeek model
 *
 * Usage:
 *   npx tsx src/appTesterOpenHands.ts <url> --codebase <path> [options]
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
const OPENHANDS_IMAGE = "ghcr.io/all-hands-ai/openhands:latest";

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
  maxIterations: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const url = args[0];

  if (!url || url.startsWith("--")) {
    console.error(
      "Usage: npx tsx src/appTesterOpenHands.ts <url> --codebase <path> [options]\n\n" +
        "Options:\n" +
        "  --codebase <path>       Path to the codebase to analyze\n" +
        "  --description <text>    Focus testing on specific flows\n" +
        "  --credentials <json>    JSON object with login credentials\n" +
        "  --tester-file <path>    Use existing TESTER.md (skip analysis)\n" +
        "  --force-analysis        Regenerate TESTER.md even if cached\n" +
        "  --output-dir <path>     Artifact output directory\n" +
        "  --max-iterations <n>    Max agent iterations (default: 50)",
    );
    process.exit(1);
  }

  const result: CliArgs = { url, forceAnalysis: false, maxIterations: 50 };

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
      case "--max-iterations":
        result.maxIterations = parseInt(args[++i], 10);
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

function verifyDocker(): void {
  try {
    execSync("docker info", { encoding: "utf-8", stdio: "pipe" });
  } catch {
    throw new Error(
      "Docker is not running or not installed.\n" +
        "OpenHands requires Docker. Install: https://docs.docker.com/get-docker/",
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
 * Run OpenHands in headless Docker mode.
 *
 * OpenHands uses Docker to create an isolated sandbox. The agent runs
 * inside the container with access to the mounted workspace directory.
 *
 * Docker run command:
 *   docker run --rm -it \
 *     -e LLM_MODEL=deepseek/deepseek-chat \
 *     -e LLM_API_KEY=$DEEPSEEK_API_KEY \
 *     -e LLM_BASE_URL=https://api.deepseek.com/v1 \
 *     -v /var/run/docker.sock:/var/run/docker.sock \
 *     -v <workspace>:/opt/workspace_base \
 *     ghcr.io/all-hands-ai/openhands:latest \
 *     python -m openhands.core.main \
 *       -t "task description" \
 *       -d /opt/workspace_base \
 *       -c CodeActAgent \
 *       --max-iterations 50
 */
function runOpenHands(opts: {
  task: string;
  workspaceDir: string;
  phase: string;
  maxIterations: number;
  extraMounts?: Array<{ host: string; container: string }>;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const dockerArgs = [
      "run", "--rm",
      // Network: use host network so agent-browser inside container
      // can reach the app at the same URL as the host
      "--network", "host",
      // Environment
      "-e", `LLM_MODEL=${DEEPSEEK_MODEL}`,
      "-e", `LLM_API_KEY=${process.env.DEEPSEEK_API_KEY ?? ""}`,
      "-e", "LLM_BASE_URL=https://api.deepseek.com/v1",
      // Mount Docker socket for sandbox
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      // Mount workspace
      "-v", `${opts.workspaceDir}:/opt/workspace_base`,
    ];

    // Add extra mounts (e.g., for screenshot dir, artifact dir)
    if (opts.extraMounts) {
      for (const mount of opts.extraMounts) {
        dockerArgs.push("-v", `${mount.host}:${mount.container}`);
      }
    }

    dockerArgs.push(
      OPENHANDS_IMAGE,
      "python", "-m", "openhands.core.main",
      "-t", opts.task,
      "-d", "/opt/workspace_base",
      "-c", "CodeActAgent",
      "--max-iterations", String(opts.maxIterations),
    );

    const child: ChildProcess = nodeSpawn("docker", dockerArgs, {
      cwd: opts.workspaceDir,
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
      else reject(new Error(`OpenHands exited with code ${code}\n${stderr}`));
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis                                         */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
  maxIterations: number,
): Promise<void> {
  log("Phase 1", "Analyzing codebase with OpenHands + DeepSeek...");
  log("Phase 1", `Codebase: ${codebasePath}`);
  log("Phase 1", `TESTER.md will be written to: ${testerMdPath}`);

  // Ensure the tester workspace exists on the host so OpenHands can write to it
  ensureDir(path.dirname(testerMdPath));

  // Map the tester MD output path to a container path
  const containerTesterPath = "/opt/workspace_base/TESTER.md";

  const task =
    `${ANALYSIS_SYSTEM_PROMPT}\n\n` +
    `Analyze the codebase at /opt/workspace_base.\n\n` +
    `${buildAnalysisPrompt(containerTesterPath)}\n\n` +
    `Write the TESTER.md file to: ${containerTesterPath}`;

  await runOpenHands({
    task,
    workspaceDir: codebasePath,
    phase: "Phase 1",
    maxIterations: Math.ceil(maxIterations * 0.4),
  });

  // OpenHands writes inside the container mount; copy from workspace if needed
  const inWorkspace = path.join(codebasePath, "TESTER.md");
  if (fs.existsSync(inWorkspace) && inWorkspace !== testerMdPath) {
    fs.copyFileSync(inWorkspace, testerMdPath);
    fs.unlinkSync(inWorkspace); // Clean up
  }

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
  maxIterations: number;
}): Promise<void> {
  log("Phase 2", "Testing app with OpenHands + agent-browser...");
  log("Phase 2", `URL: ${opts.baseUrl}`);

  // Write the test plan into the artifact dir so OpenHands can read it
  const testerMdCopy = path.join(opts.artifactDir, "TESTER.md");
  fs.writeFileSync(testerMdCopy, opts.testerMd);

  // Container paths
  const containerScreenshots = "/opt/workspace_base/screenshots";
  const containerArtifacts = "/opt/workspace_base";

  const testPromptBody = buildTestPrompt({
    baseUrl: opts.baseUrl,
    testerMd: opts.testerMd,
    description: opts.description,
    credentials: opts.credentials,
    screenshotDir: containerScreenshots,
    artifactDir: containerArtifacts,
    mockEmail: opts.mockEmail,
  });

  const task =
    `${TESTING_SYSTEM_PROMPT}\n\n${testPromptBody}\n\n` +
    `IMPORTANT SETUP:\n` +
    `First, install agent-browser: npm install -g agent-browser && agent-browser install\n` +
    `Then execute all browser testing commands using agent-browser CLI.\n` +
    `Save screenshots to: ${containerScreenshots}/\n` +
    `Write reports to: ${containerArtifacts}/`;

  await runOpenHands({
    task,
    workspaceDir: opts.artifactDir,
    phase: "Phase 2",
    maxIterations: opts.maxIterations,
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
  verifyDocker();
  verifyDeepSeekApiKey();

  const runId = `openhands-test-${Date.now()}`;
  const artifactDir = cli.outputDir ?? path.join(CONFIG.artifactRoot, runId);
  const screenshotDir = path.join(artifactDir, "screenshots");
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(CONFIG.agentTesterWorkspace);

  log("Main", `Run ID: ${runId}`);
  log("Main", `Target: ${cli.url}`);
  log("Main", `Agent: OpenHands + DeepSeek (${DEEPSEEK_MODEL})`);
  log("Main", `Max iterations: ${cli.maxIterations}`);
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
      await runAnalysis(cli.codebasePath!, testerMdPath, cli.maxIterations);
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
    maxIterations: cli.maxIterations,
  });

  collectReport(artifactDir, screenshotDir);

  log("Main", "\u2500".repeat(50));
  log("Main", `Done. Artifacts: ${artifactDir}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
