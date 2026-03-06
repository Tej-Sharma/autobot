/**
 * AI Test Runner — runs on the Fly.io agent machine.
 *
 * Supports two modes:
 *   - scriptgen: Generate Playwright scripts via LLM, execute deterministically, evaluate
 *   - agentic:   Claude Agent SDK + agent-browser for real-time AI browser control
 *
 * The codebase is already cloned at /workspace/repo/ and the dev server is running
 * on localhost:{port} by the time this is called.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDevServerPort } from './devServer';
import { getRepoDir } from './cloneRunner';
import {
  ANALYSIS_SYSTEM_PROMPT,
  TESTING_SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildGroupTestPrompt,
  buildReportPrompt,
  parseFlows,
  parseCodeFaults,
  filterFlows,
  groupFlows,
} from './appTesterPrompts';
import {
  SCRIPT_GEN_SYSTEM_PROMPT,
  EVAL_SYSTEM_PROMPT,
  buildScriptGenPrompt,
  buildEvalPrompt,
} from './appTesterScriptGenPrompts';
import type { AiTestRequest, AiTestResult, AiTestReport, AiTestFinding } from './types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const WORKSPACE = '/workspace';
const REPO_DIR = path.join(WORKSPACE, 'repo');
const TESTER_CACHE_DIR = path.join(WORKSPACE, 'testers');
const ARTIFACT_BASE = path.join(WORKSPACE, 'test-artifacts');

const DEFAULT_MODEL = process.env.AGENT_MODEL ?? 'claude-haiku-4-5-20251001';
const DEFAULT_BUDGET = Number.parseFloat(process.env.AGENT_MAX_BUDGET_USD ?? '3');

/* ------------------------------------------------------------------ */
/*  SDK helpers                                                        */
/* ------------------------------------------------------------------ */

function resolveClaudeCli(): string {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Claude Code CLI not found. Ensure @anthropic-ai/claude-code is installed globally.');
  }
}

function resolveClaudeEntrypoint(): string {
  const cli = resolveClaudeCli();
  const real = fs.realpathSync(cli);
  if (real.endsWith('.js') || real.endsWith('.mjs')) return real;
  return cli;
}

function resolveNodeBin(): string {
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim();
  } catch {
    return 'node';
  }
}

function ensureNodeOnPath(): void {
  const nodeBin = resolveNodeBin();
  const nodeDir = path.dirname(nodeBin);
  const currentPath = process.env.PATH ?? '';
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
      const cmd = opts.command === 'node' ? nodeBin : opts.command;
      const child = spawn(cmd, opts.args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
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
  const rand = crypto.randomBytes(3).toString('hex');
  return `test-${ts}-${rand}@autobot-test.com`;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function log(phase: string, message: string): void {
  const ts = new Date().toLocaleTimeString();
  console.log(`[${ts}] [aiTest:${phase}] ${message}`);
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
  let resultText = '';

  const response = query({
    prompt: opts.prompt,
    options: {
      ...base,
      model: DEFAULT_MODEL,
      cwd: opts.cwd,
      allowedTools: opts.tools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: opts.budget,
      systemPrompt: opts.systemPrompt,
    },
  });

  for await (const message of response) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          const text = block.text.trim();
          resultText += text + '\n';
          if (opts.verbose !== false) {
            const firstLine = text.split('\n')[0];
            log(opts.phase, firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine);
          }
        }
      }
    } else if (message.type === 'result') {
      totalCost = message.total_cost_usd;
      if (message.subtype === 'success') {
        resultText = message.result;
        log(opts.phase, `Done. Cost: $${totalCost.toFixed(4)}`);
      } else {
        log(opts.phase, `Ended: ${message.subtype}. Cost: $${totalCost.toFixed(4)}`);
        if ('errors' in message) {
          for (const err of message.errors) log(opts.phase, `Error: ${err}`);
        }
      }
    }
  }

  return { result: resultText, cost: totalCost };
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis (shared by both modes)                  */
/* ------------------------------------------------------------------ */

async function runAnalysis(
  codebasePath: string,
  testerMdPath: string,
  budget: number,
): Promise<{ cost: number }> {
  log('Phase1', 'Analyzing codebase + finding code faults...');
  log('Phase1', `Codebase: ${codebasePath}`);
  log('Phase1', `Output: ${testerMdPath}`);

  const { cost } = await runClaudeQuery({
    prompt: buildAnalysisPrompt(testerMdPath),
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    cwd: codebasePath,
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
    budget,
    phase: 'Phase1',
  });

  if (!fs.existsSync(testerMdPath)) {
    throw new Error(`Phase 1 failed: TESTER.md not written to ${testerMdPath}`);
  }

  log('Phase1', `TESTER.md saved (${fs.statSync(testerMdPath).size} bytes)`);
  return { cost };
}

/* ------------------------------------------------------------------ */
/*  Scriptgen mode: Phase 2-4                                          */
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
  const basename = path.basename(scriptFile, '.ts');
  const resultFile = path.join(path.dirname(scriptFile), `results-${basename.replace('test-', '')}.json`);
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      'npx',
      ['tsx', scriptFile, baseUrl, screenshotDir, resultFile],
      {
        cwd: path.dirname(scriptFile),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout: 120_000,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => {
      resolve({ scriptFile, exitCode: 1, stdout, stderr: stderr + `\nSpawn error: ${err.message}`, duration: Date.now() - startTime, resultFile });
    });

    child.on('exit', (code) => {
      resolve({ scriptFile, exitCode: code ?? 1, stdout, stderr, duration: Date.now() - startTime, resultFile });
    });
  });
}

async function runScriptgenPipeline(opts: {
  testerMd: string;
  codeFaults: string;
  baseUrl: string;
  credentials?: Record<string, string>;
  mockEmail: string;
  artifactDir: string;
  screenshotDir: string;
  budget: number;
}): Promise<{ cost: number; reportJson: AiTestReport | null }> {
  const { testerMd, codeFaults, baseUrl, credentials, mockEmail, artifactDir, screenshotDir, budget } = opts;
  const scriptDir = path.join(artifactDir, 'scripts');
  ensureDir(scriptDir);

  let totalCost = 0;

  // Phase 2: Generate Playwright scripts
  const allFlows = parseFlows(testerMd);
  log('Phase2', `Parsed ${allFlows.length} flows from TESTER.md`);

  if (allFlows.length === 0) {
    throw new Error('No structured flows found in TESTER.md');
  }

  const hasCredentials = Boolean(credentials && Object.keys(credentials).length);
  const filtered = filterFlows(allFlows, hasCredentials);
  const skippedCount = allFlows.length - filtered.length;
  const groups = groupFlows(filtered);

  log('Phase2', `Generating scripts for ${filtered.length} flows in ${groups.length} groups...`);

  const scriptGenBudget = budget * 0.4;
  const prompt = buildScriptGenPrompt({
    testerMd,
    groups,
    baseUrl,
    credentials,
    mockEmail,
    screenshotDir,
    scriptDir,
  });

  const genResult = await runClaudeQuery({
    prompt,
    systemPrompt: SCRIPT_GEN_SYSTEM_PROMPT,
    cwd: scriptDir,
    tools: ['Write'],
    budget: scriptGenBudget,
    phase: 'Phase2',
  });
  totalCost += genResult.cost;

  const scriptFiles = fs.existsSync(scriptDir)
    ? fs.readdirSync(scriptDir).filter((f) => f.startsWith('test-') && f.endsWith('.ts')).map((f) => path.join(scriptDir, f)).sort()
    : [];

  log('Phase2', `Generated ${scriptFiles.length} test scripts`);

  // Phase 3: Execute scripts (zero LLM calls)
  log('Phase3', `Executing ${scriptFiles.length} scripts...`);
  const execResults: ScriptResult[] = [];

  for (const scriptFile of scriptFiles) {
    log('Phase3', `Running: ${path.basename(scriptFile)}`);
    const result = await executeScript(scriptFile, baseUrl, screenshotDir);
    log('Phase3', `  ${result.exitCode === 0 ? 'OK' : 'FAILED'} (${(result.duration / 1000).toFixed(1)}s)`);
    execResults.push(result);
  }

  // Phase 4: Evaluate results
  const evalBudget = budget * 0.3;
  const resultFiles = execResults.map((r) => r.resultFile).filter((f) => fs.existsSync(f));

  const execSummaryPath = path.join(scriptDir, 'execution-summary.json');
  fs.writeFileSync(execSummaryPath, JSON.stringify(execResults.map((r) => ({
    script: path.basename(r.scriptFile),
    exitCode: r.exitCode,
    duration: r.duration,
    hasResults: fs.existsSync(r.resultFile),
    stderrTail: r.stderr ? r.stderr.trim().split('\n').slice(-5).join('\n') : '',
  })), null, 2));
  resultFiles.push(execSummaryPath);

  log('Phase4', `Evaluating ${resultFiles.length} result files...`);

  const evalPrompt = buildEvalPrompt({
    artifactDir,
    screenshotDir,
    scriptDir,
    resultFiles,
    codeFaults,
    baseUrl,
    totalFlows: allFlows.length,
    skippedFlows: skippedCount,
  });

  const evalResult = await runClaudeQuery({
    prompt: evalPrompt,
    systemPrompt: EVAL_SYSTEM_PROMPT,
    cwd: artifactDir,
    tools: ['Read', 'Write', 'Glob'],
    budget: evalBudget,
    phase: 'Phase4',
  });
  totalCost += evalResult.cost;

  // Parse the report JSON
  const reportJson = readReportJson(artifactDir);

  return { cost: totalCost, reportJson };
}

/* ------------------------------------------------------------------ */
/*  Agentic mode: Phase 2-3                                            */
/* ------------------------------------------------------------------ */

async function runAgenticPipeline(opts: {
  testerMd: string;
  codeFaults: string;
  baseUrl: string;
  credentials?: Record<string, string>;
  mockEmail: string;
  artifactDir: string;
  screenshotDir: string;
  budget: number;
}): Promise<{ cost: number; reportJson: AiTestReport | null }> {
  const { testerMd, codeFaults, baseUrl, credentials, mockEmail, artifactDir, screenshotDir, budget } = opts;

  let totalCost = 0;

  // Parse flows
  const allFlows = parseFlows(testerMd);
  log('Phase2', `Parsed ${allFlows.length} flows from TESTER.md`);

  if (allFlows.length === 0) {
    throw new Error('No structured flows found in TESTER.md');
  }

  const hasCredentials = Boolean(credentials && Object.keys(credentials).length);
  const filtered = filterFlows(allFlows, hasCredentials);
  const skippedCount = allFlows.length - filtered.length;
  const groups = groupFlows(filtered);

  const testBudget = budget * 0.85;
  const reportBudget = budget * 0.15;
  const budgetPerGroup = testBudget / groups.length;
  const groupResults: Array<{ groupName: string; output: string }> = [];

  // Init browser
  log('Phase2', 'Opening browser...');
  const initResult = await runClaudeQuery({
    prompt: `Run: agent-browser open ${baseUrl} && agent-browser wait --load networkidle && echo "Browser ready"`,
    systemPrompt: 'Open the browser.',
    cwd: artifactDir,
    tools: ['Bash'],
    budget: budgetPerGroup * 0.1,
    phase: 'Init',
    verbose: false,
  });
  totalCost += initResult.cost;

  // Execute each group
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    log('Phase2', `Group ${i + 1}/${groups.length}: ${group.groupName}`);

    const prompt = buildGroupTestPrompt({
      baseUrl,
      group,
      codeFaults,
      credentials,
      screenshotDir,
      mockEmail,
      groupIndex: i,
      totalGroups: groups.length,
    });

    const { result, cost } = await runClaudeQuery({
      prompt,
      systemPrompt: TESTING_SYSTEM_PROMPT,
      cwd: artifactDir,
      tools: ['Bash', 'Read', 'Write'],
      budget: budgetPerGroup,
      phase: `Group${i + 1}`,
    });

    totalCost += cost;
    groupResults.push({ groupName: group.groupName, output: result });
  }

  // Close browser
  log('Phase2', 'Closing browser...');
  const closeResult = await runClaudeQuery({
    prompt: 'Run: agent-browser close',
    systemPrompt: 'Close browser.',
    cwd: artifactDir,
    tools: ['Bash'],
    budget: budgetPerGroup * 0.05,
    phase: 'Cleanup',
    verbose: false,
  });
  totalCost += closeResult.cost;

  // Write report
  log('Phase3', 'Writing report...');
  const reportResult = await runClaudeQuery({
    prompt: buildReportPrompt({
      artifactDir,
      groupResults,
      codeFaults,
      baseUrl,
      totalFlows: allFlows.length,
      skippedFlows: skippedCount,
    }),
    systemPrompt: 'Write clear, structured test reports.',
    cwd: artifactDir,
    tools: ['Write'],
    budget: reportBudget,
    phase: 'Report',
  });
  totalCost += reportResult.cost;

  const reportJson = readReportJson(artifactDir);

  return { cost: totalCost, reportJson };
}

/* ------------------------------------------------------------------ */
/*  URL-only exploration mode                                          */
/* ------------------------------------------------------------------ */

async function runUrlExploration(opts: {
  baseUrl: string;
  credentials?: Record<string, string>;
  artifactDir: string;
  screenshotDir: string;
  budget: number;
}): Promise<{ cost: number }> {
  const { baseUrl, credentials, artifactDir, screenshotDir, budget } = opts;

  let totalCost = 0;
  const testBudget = budget * 0.85;
  const reportBudget = budget * 0.15;

  const credentialBlock = credentials && Object.keys(credentials).length > 0
    ? `\n\nYou have test account credentials:\n${Object.entries(credentials).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\nUse these to log in and test authenticated features.`
    : '';

  // Open browser
  log('Explore', 'Opening browser...');
  const initResult = await runClaudeQuery({
    prompt: `Run: agent-browser open ${baseUrl} && agent-browser wait --load networkidle && echo "Browser ready"`,
    systemPrompt: 'Open the browser.',
    cwd: artifactDir,
    tools: ['Bash'],
    budget: testBudget * 0.05,
    phase: 'Init',
    verbose: false,
  });
  totalCost += initResult.cost;

  // Main exploration
  log('Explore', 'Running AI exploration...');
  const explorationPrompt = `You are testing the web application at ${baseUrl}.
Screenshots should be saved to: ${screenshotDir}
${credentialBlock}

## Your Testing Strategy

1. **Discover**: Start by taking a snapshot and screenshot of the landing page. Identify all navigation links, buttons, and interactive elements.

2. **Exhaust current state before advancing**: Before clicking any link that would change the page/state (like logging in, navigating away), first test ALL edge cases and interactions on the current page:
   - Try all buttons and interactive elements
   - Test form validations (empty submissions, invalid inputs)
   - Check responsive behavior
   - Verify all links are clickable
   - Look for visual bugs, broken layouts, missing content

3. **Navigate systematically**: After exhausting the current page, move to the next logical page. Use breadth-first exploration:
   - Test all top-level navigation pages first
   - Then test deeper flows (auth, forms, dashboards)
   - Always backtrack to discover pages you haven't visited

4. **Auth testing**: If credentials are provided, test the auth flow:
   - First test all pre-auth edge cases (invalid credentials, empty fields)
   - Then log in with the provided credentials
   - Test all authenticated features thoroughly

5. **Error threshold**: If you find 3 distinct bugs/errors, STOP testing immediately and proceed to write the report. No need to find more — 3 is enough to flag the build.

6. **Screenshots**: Take a screenshot after every significant interaction or when you find a bug. Name them descriptively: page-name-action.png

## Commands Available
- agent-browser snapshot — get page accessibility tree
- agent-browser screenshot <filepath> — capture screenshot
- agent-browser click <ref> — click element by ref number
- agent-browser fill <ref> <value> — fill input
- agent-browser navigate <url> — go to URL
- agent-browser scroll_down / scroll_up — scroll page
- agent-browser wait --load networkidle — wait for page load
- agent-browser close — close browser

## Important Rules
- ALWAYS run \`agent-browser snapshot\` before interacting with any element
- Use ref numbers from the snapshot to click/fill elements
- Take screenshots frequently, especially when finding issues
- Be thorough but efficient — test real user flows`;

  const exploreResult = await runClaudeQuery({
    prompt: explorationPrompt,
    systemPrompt: TESTING_SYSTEM_PROMPT,
    cwd: artifactDir,
    tools: ['Bash', 'Read', 'Write'],
    budget: testBudget,
    phase: 'Explore',
  });
  totalCost += exploreResult.cost;

  // Close browser
  log('Explore', 'Closing browser...');
  const closeResult = await runClaudeQuery({
    prompt: 'Run: agent-browser close',
    systemPrompt: 'Close browser.',
    cwd: artifactDir,
    tools: ['Bash'],
    budget: reportBudget * 0.1,
    phase: 'Cleanup',
    verbose: false,
  });
  totalCost += closeResult.cost;

  // Write report
  log('Explore', 'Writing report...');
  const reportResult = await runClaudeQuery({
    prompt: `Based on your exploration of ${baseUrl}, write a QA test report.

Write TWO files:
1. ${artifactDir}/agent-test-report.md — Human-readable markdown report with:
   - Summary of what was tested
   - List of findings with severity and screenshots
   - Overall assessment

2. ${artifactDir}/agent-test-report.json — Structured JSON:
{
  "status": "passed" | "failed" | "partial",
  "flowsTotal": <number of pages/flows tested>,
  "flowsPassed": <number that passed>,
  "flowsFailed": <number that failed>,
  "flowsSkipped": 0,
  "codeFaults": 0,
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "<category>",
      "message": "<description>",
      "screenshot": "<screenshot filename if available>"
    }
  ]
}

Use "failed" status if ANY critical/high finding exists. "partial" if only medium. "passed" if only low or none.
Review your testing session output and screenshots to compile the report.`,
    systemPrompt: 'Write clear, structured test reports.',
    cwd: artifactDir,
    tools: ['Write', 'Read', 'Glob'],
    budget: reportBudget,
    phase: 'Report',
  });
  totalCost += reportResult.cost;

  return { cost: totalCost };
}

/* ------------------------------------------------------------------ */
/*  Report + screenshot helpers                                        */
/* ------------------------------------------------------------------ */

function readReportJson(artifactDir: string): AiTestReport | null {
  const jsonPath = path.join(artifactDir, 'agent-test-report.json');
  if (!fs.existsSync(jsonPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const mdPath = path.join(artifactDir, 'agent-test-report.md');
    const reportMd = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf-8') : '';

    return {
      status: raw.status === 'passed' ? 'pass' : raw.status === 'failed' ? 'fail' : raw.status === 'partial' ? 'partial' : 'error',
      flowsTotal: raw.flowsTotal ?? 0,
      flowsPassed: raw.flowsPassed ?? 0,
      flowsFailed: raw.flowsFailed ?? 0,
      flowsSkipped: raw.flowsSkipped ?? 0,
      codeFaults: raw.codeFaults ?? 0,
      findings: Array.isArray(raw.findings)
        ? raw.findings.map((f: Record<string, unknown>) => ({
            severity: f.severity ?? 'medium',
            category: String(f.category ?? ''),
            message: String(f.message ?? ''),
            flowId: f.flowId ? String(f.flowId) : undefined,
            screenshot: f.screenshot ? String(f.screenshot) : undefined,
          } as AiTestFinding))
        : [],
      costUsd: 0, // filled in by caller
      durationMs: 0, // filled in by caller
      reportMd,
      screenshotKeys: [],
    };
  } catch {
    log('Report', 'Warning: Could not parse agent-test-report.json');
    return null;
  }
}

function collectScreenshots(screenshotDir: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(screenshotDir)) return result;

  const files = fs.readdirSync(screenshotDir).filter((f) => f.endsWith('.png'));
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(screenshotDir, file));
      result[file] = data.toString('base64');
    } catch {
      // skip unreadable files
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function runAiTest(req: AiTestRequest): Promise<AiTestResult> {
  const startTime = Date.now();

  // Resolve base URL: explicit > dev server
  const devServerPort = getDevServerPort();
  const baseUrl = req.baseUrl ?? (devServerPort ? `http://localhost:${devServerPort}` : null);
  if (!baseUrl) {
    return {
      success: false,
      report: null,
      screenshots: {},
      error: 'No baseUrl provided and dev server is not running.',
      durationMs: Date.now() - startTime,
    };
  }

  const budget = req.budget ?? DEFAULT_BUDGET;
  const codebasePath = getRepoDir();
  const hasRepo = fs.existsSync(codebasePath) && fs.readdirSync(codebasePath).length > 0;

  const runId = `ai-test-${Date.now()}`;
  const artifactDir = path.join(ARTIFACT_BASE, runId);
  const screenshotDir = path.join(artifactDir, 'screenshots');
  ensureDir(artifactDir);
  ensureDir(screenshotDir);
  ensureDir(TESTER_CACHE_DIR);

  log('Main', `Mode: ${req.mode} | Budget: $${budget.toFixed(2)} | URL: ${baseUrl} | HasRepo: ${hasRepo}`);

  let totalCost = 0;

  try {
    if (hasRepo) {
      // ---- Full mode: codebase analysis + structured testing ----
      const repoName = path.basename(codebasePath);
      const testerMdPath = path.join(TESTER_CACHE_DIR, `${repoName}-TESTER.md`);

      if (fs.existsSync(testerMdPath) && !req.forceAnalysis) {
        log('Phase1', `Using cached TESTER.md: ${testerMdPath}`);
      } else {
        const analysisResult = await runAnalysis(codebasePath, testerMdPath, budget * 0.3);
        totalCost += analysisResult.cost;
      }

      const testerMd = fs.readFileSync(testerMdPath, 'utf-8');
      const codeFaults = parseCodeFaults(testerMd);
      const mockEmail = generateMockEmail();
      const remainingBudget = budget - totalCost;

      let pipelineResult: { cost: number; reportJson: AiTestReport | null };

      if (req.mode === 'scriptgen') {
        pipelineResult = await runScriptgenPipeline({
          testerMd,
          codeFaults,
          baseUrl,
          credentials: req.credentials,
          mockEmail,
          artifactDir,
          screenshotDir,
          budget: remainingBudget,
        });
      } else {
        pipelineResult = await runAgenticPipeline({
          testerMd,
          codeFaults,
          baseUrl,
          credentials: req.credentials,
          mockEmail,
          artifactDir,
          screenshotDir,
          budget: remainingBudget,
        });
      }

      totalCost += pipelineResult.cost;
    } else {
      // ---- URL-only mode: explore the live app without codebase ----
      log('Main', 'No repo — running URL-only exploration mode');

      const explorationResult = await runUrlExploration({
        baseUrl,
        credentials: req.credentials,
        artifactDir,
        screenshotDir,
        budget,
      });
      totalCost += explorationResult.cost;
    }

    // Collect screenshots
    const screenshots = collectScreenshots(screenshotDir);

    // Finalize report
    const report = readReportJson(artifactDir);
    if (report) {
      report.costUsd = totalCost;
      report.durationMs = Date.now() - startTime;
      report.screenshotKeys = Object.keys(screenshots);
    }

    log('Main', `Done. Cost: $${totalCost.toFixed(4)} | Screenshots: ${Object.keys(screenshots).length}`);

    return {
      success: true,
      report,
      screenshots,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log('Main', `Failed: ${errMsg}`);

    const screenshots = collectScreenshots(screenshotDir);

    return {
      success: false,
      report: null,
      screenshots,
      error: errMsg,
      durationMs: Date.now() - startTime,
    };
  }
}
