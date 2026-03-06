/**
 * Local test runner — skips all Fly machine infra.
 * Just runs the agentic browser testing against a local URL.
 *
 * Usage: npx tsx src/localTest.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  Config — hardcoded for local testing                               */
/* ------------------------------------------------------------------ */

const BASE_URL = 'http://localhost:3000';
const CODEBASE_PATH = '/Users/tejas1/Documents/Constella Codebases/web';
const ARTIFACT_DIR = path.join(process.cwd(), '.local-test-artifacts', `run-${Date.now()}`);
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, 'screenshots');
const TESTER_CACHE = path.join(process.cwd(), '.local-test-artifacts', 'TESTER.md');

const MODEL = process.env.AGENT_MODEL ?? 'claude-haiku-4-5-20251001';
const BUDGET = Number.parseFloat(process.env.AGENT_MAX_BUDGET_USD ?? '5');

const CREDENTIALS = {
  email: 'mobiletest3@g.com',
  password: 'password',
};

const APP_DESCRIPTION = `This is Constella — a web node canvas app for research.
It uses Next.js + React + Firebase Auth. The main feature is an interactive
research canvas at /canvas where users create, connect, and organize research nodes.
Auth is at /auth with email/password and Google/Apple OAuth.`;

/* ------------------------------------------------------------------ */
/*  SDK helpers (copied from aiTestRunner)                             */
/* ------------------------------------------------------------------ */

function resolveClaudeCli(): string {
  return execSync('which claude', { encoding: 'utf-8' }).trim();
}

function resolveClaudeEntrypoint(): string {
  const cli = resolveClaudeCli();
  const real = fs.realpathSync(cli);
  if (real.endsWith('.js') || real.endsWith('.mjs')) return real;
  return cli;
}

function resolveNodeBin(): string {
  try { return execSync('which node', { encoding: 'utf-8' }).trim(); }
  catch { return 'node'; }
}

function ensureNodeOnPath(): void {
  const nodeBin = resolveNodeBin();
  const nodeDir = path.dirname(nodeBin);
  if (!process.env.PATH?.includes(nodeDir)) {
    process.env.PATH = `${nodeDir}:${process.env.PATH ?? ''}`;
  }
}

function sdkBaseOptions() {
  ensureNodeOnPath();
  const nodeBin = resolveNodeBin();
  const entrypoint = resolveClaudeEntrypoint();
  return {
    pathToClaudeCodeExecutable: entrypoint,
    spawnClaudeCodeProcess: (opts: {
      command: string; args: string[]; cwd?: string;
      env?: Record<string, string | undefined>; signal?: AbortSignal;
    }) => {
      const cmd = opts.command === 'node' ? nodeBin : opts.command;
      const cleanEnv = { ...opts.env } as Record<string, string | undefined>;
      delete cleanEnv.CLAUDECODE;
      const child = spawn(cmd, opts.args, {
        cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'],
        signal: opts.signal, env: cleanEnv as NodeJS.ProcessEnv, windowsHide: true,
      });
      return {
        stdin: child.stdin, stdout: child.stdout,
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

function log(phase: string, msg: string): void {
  console.log(`[${new Date().toLocaleTimeString()}] [${phase}] ${msg}`);
}

function ensureDir(p: string): void {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/* ------------------------------------------------------------------ */
/*  Run a Claude query                                                 */
/* ------------------------------------------------------------------ */

async function runClaude(opts: {
  prompt: string; systemPrompt: string; cwd: string;
  tools: string[]; budget: number; phase: string; verbose?: boolean;
}): Promise<{ result: string; cost: number }> {
  const base = sdkBaseOptions();
  let totalCost = 0;
  let resultText = '';

  const response = query({
    prompt: opts.prompt,
    options: {
      ...base, model: MODEL, cwd: opts.cwd,
      allowedTools: opts.tools, permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      maxBudgetUsd: opts.budget, systemPrompt: opts.systemPrompt,
    },
  });

  for await (const message of response) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) {
          const text = block.text.trim();
          resultText += text + '\n';
          if (opts.verbose !== false) {
            const line = text.split('\n')[0];
            log(opts.phase, line.length > 140 ? `${line.slice(0, 137)}...` : line);
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
      }
    }
  }

  return { result: resultText, cost: totalCost };
}

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase analysis → TESTER.md                            */
/* ------------------------------------------------------------------ */

const ANALYSIS_SYSTEM_PROMPT = `You are an expert QA engineer analyzing a web application codebase.

You have TWO jobs:
1. Find code-level faults (bugs, security issues, bad patterns) by reading the source
2. Produce a TESTER.md that maps out every testable user flow

${APP_DESCRIPTION}

For code faults, look for: security issues, logic bugs, missing error handling,
dead code, hardcoded values, race conditions, accessibility problems.

Report these in a CODE_FAULTS section.`;

function buildAnalysisPrompt(): string {
  return `Analyze the codebase in the current working directory.

Read through the project. Focus on:
1. All routes/pages — every URL the app serves
2. Authentication — signup, login, logout, OAuth
3. Forms and fields — field names, types, validation
4. Key interactive elements — buttons, modals, dropdowns
5. Navigation structure
6. Code quality issues

Write a TESTER.md to: ${TESTER_CACHE}

Use this EXACT format for each flow:

<!-- FLOW_START -->
\`\`\`json
{
  "id": "unique-id",
  "name": "Human Name",
  "kind": "page|navigation|sequential|rooted|api",
  "auth": true/false,
  "priority": "critical|high|medium|low",
  "route": "/path",
  "sections": ["Section1", "Section2"],
  "buttons": ["Button Text 1"],
  "startFrom": null,
  "chain": null
}
\`\`\`
### Human Name
**Steps:** ...
<!-- FLOW_END -->

Flow kinds:
- page: scroll through sections, click each button, backtrack
- navigation: test redirects and URL changes
- sequential: multi-step chain (login → dashboard)
- rooted: flows sharing a start page (has startFrom + chain)
- api: curl endpoints

Be thorough — find every route and interactive element.`;
}

/* ------------------------------------------------------------------ */
/*  Phase 2: Agentic testing with state backtracking                   */
/* ------------------------------------------------------------------ */

const TESTING_SYSTEM_PROMPT = `You are an expert QA tester. You test a web app using agent-browser CLI commands via Bash.

## agent-browser Commands
Navigation: open, back, forward, reload
Input: fill, type, press, select, check, uncheck
Actions: click, dblclick, hover, scroll
Info: snapshot -i, get text, get url, get title, get value
Wait: wait <selector>, wait <ms>, wait --load networkidle, wait --text "..."
Capture: screenshot <path>, screenshot <path> --full
State: state save <name>, state load <name>
Find: find text "..." click, find role button click --name "Submit"

## ABSOLUTE RULES — READ THESE FIRST

1. **STAY ON THE CURRENT PAGE.** Do NOT navigate to /account, /upgrade, /settings, or any other page unless the test plan EXPLICITLY tells you to. Your job is to deeply test the page you are on.
2. **USE state save/load FOR EVERY TEST.** Before testing anything, run \`agent-browser state save <name>\`. After each test, run \`agent-browser state load <name>\` to reset. NO EXCEPTIONS.
3. **TEST DEPTH OVER BREADTH.** Spend 80% of your time on the primary page (canvas). Click every button, try every interaction, test every edge case ON THAT PAGE before moving anywhere.
4. **NEVER GIVE UP AFTER ONE ERROR.** If one feature fails (e.g. credits), move to the NEXT interactive element on the SAME page. There are dozens of things to test on any page.
5. **DO NOT write reports mid-test.** Test everything first, write the report at the very end.

## State Backtracking Protocol

Every single test MUST follow this pattern:
\`\`\`
agent-browser state save "test-<name>"
<do the test — click, fill, interact>
agent-browser screenshot <path>
agent-browser state load "test-<name>"
\`\`\`

If you skip state save/load, you are doing it wrong. This is NON-NEGOTIABLE.

## Testing Order Per Page:
1. Screenshot initial state
2. \`agent-browser snapshot -i\` to see ALL interactive elements
3. \`agent-browser state save "page-<name>"\`
4. For EACH interactive element visible in the snapshot:
   a. Test it (click, fill, hover, etc.)
   b. Screenshot the result
   c. \`agent-browser state load "page-<name>"\` to reset
   d. \`agent-browser snapshot -i\` again (refs invalidate after state load)
5. Test FAILURE cases (empty inputs, invalid data, wrong values)
6. Test SUCCESS cases last
7. Only move to the next page when you have tested EVERY element

## Rules
- ALWAYS snapshot -i before interacting (refs get invalidated on page change or state load)
- Re-snapshot after ANY navigation, state load, or page change
- Screenshot EVERY test result
- If something fails, NOTE IT and move to the next element — do NOT leave the page
- Check console errors periodically: agent-browser evaluate "JSON.stringify(window.__errors || [])"
- NEVER navigate away from the primary test page to "explore" other routes`;

function buildTestPrompt(
  testerMd: string, codeFaults: string, screenshotDir: string,
): string {
  return `Test the web application at: ${BASE_URL}

## App Context
${APP_DESCRIPTION}

## Credentials
Email: ${CREDENTIALS.email}
Password: ${CREDENTIALS.password}

## Known Code Faults
${codeFaults || 'None found yet.'}

## YOUR MISSION — READ CAREFULLY

You have TWO phases. Phase A is quick (auth). Phase B is where you spend 90% of your time (canvas).
DO NOT visit /account, /upgrade, /settings, or any other page. Only /auth and /canvas.

### Phase A: Auth Page (QUICK — 10% of time)
1. \`agent-browser open ${BASE_URL}/auth\`
2. \`agent-browser wait --load networkidle\`
3. \`agent-browser screenshot ${screenshotDir}/01-001-auth-initial.png\`
4. \`agent-browser snapshot -i\`
5. \`agent-browser state save "auth-start"\`
6. Test FAILURE cases (for each: try → screenshot → state load "auth-start" → snapshot -i):
   a. Empty submit: click Sign In with empty fields
   b. Invalid email: fill "notanemail" → submit
   c. Wrong password: fill "${CREDENTIALS.email}" + "wrongpass123!" → submit
   d. Non-existent account: fill "nobody999@test.com" + "somepass123!" → submit
7. SUCCESS: fill ${CREDENTIALS.email} / ${CREDENTIALS.password} → Sign In
8. Wait for redirect, screenshot post-login state

### Phase B: Canvas Deep Testing (THIS IS THE MAIN EVENT — 90% of time)
After login you'll land on /canvas. This is a research canvas with nodes, connections, and tools.
Your job is to find and test EVERY interactive element on this page.

1. \`agent-browser wait --load networkidle\`
2. \`agent-browser screenshot ${screenshotDir}/02-001-canvas-initial.png\`
3. \`agent-browser snapshot -i\` — LIST every interactive element you see
4. \`agent-browser state save "canvas-base"\`

Now for EACH element you found in the snapshot:
5. Test it:
   - \`agent-browser state save "canvas-test-<element-name>"\`
   - Interact with it (click, fill, hover, toggle, etc.)
   - \`agent-browser screenshot ${screenshotDir}/02-NNN-<description>.png\`
   - Note what happened — did it open a panel? Show a modal? Change state? Error?
   - \`agent-browser state load "canvas-base"\`
   - \`agent-browser snapshot -i\` (refs invalidate after state load)

6. Things to specifically test on canvas (if they exist):
   - Text input area — type content, clear it, paste long text
   - Build canvas / submit button — try with empty input, short input, long input
   - AI toggle — toggle on/off, check what changes
   - Settings gear icon — click it, explore what opens
   - Notification icon — click it
   - Any sidebar or panel toggles
   - Right-click on canvas area (context menu?)
   - Double-click on canvas area
   - Keyboard shortcuts (Ctrl+Z, Ctrl+S, Escape, Tab, Enter)
   - Drag and drop on the canvas
   - Scroll behavior on canvas
   - Any "connect to" integration buttons
   - File upload / drop zone — try dragging or clicking it
   - Any existing nodes — click, drag, edit, delete
   - Zoom controls if visible
   - Any modals or overlays that appear
   - Hover states on elements

7. For any panel/modal/overlay that opens:
   - \`agent-browser snapshot -i\` the new elements
   - Test interactions inside it
   - Screenshot
   - Close/dismiss it
   - State load back to canvas-base

8. If a feature errors (like credits), NOTE IT and move to the NEXT element. Do NOT leave canvas.

## Output Format
For each test, write:
- PASS: canvas — <element> — <what worked>
- FAIL: canvas — <element> — <what broke and how>
- NOTE: canvas — <element> — <observation>

Save screenshots to: ${screenshotDir}/
Naming: XX-NNN-description.png (01=auth, 02=canvas)
Increment NNN for each screenshot.

After ALL tests complete, write a summary to ${ARTIFACT_DIR}/test-notes.md`;
}

/* ------------------------------------------------------------------ */
/*  Flow parsing (simplified from appTesterPrompts)                    */
/* ------------------------------------------------------------------ */

function parseCodeFaults(testerMd: string): string {
  const match = testerMd.match(/## Code Faults Found[\s\S]*?(?=\n## )/);
  return match ? match[0].trim() : '';
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const startTime = Date.now();
  let totalCost = 0;

  ensureDir(ARTIFACT_DIR);
  ensureDir(SCREENSHOT_DIR);
  ensureDir(path.dirname(TESTER_CACHE));

  log('Main', `Testing: ${BASE_URL}`);
  log('Main', `Codebase: ${CODEBASE_PATH}`);
  log('Main', `Artifacts: ${ARTIFACT_DIR}`);
  log('Main', `Budget: $${BUDGET}`);

  // Phase 1: Analyze codebase (or use cache)
  if (fs.existsSync(TESTER_CACHE)) {
    log('Phase1', `Using cached TESTER.md (${TESTER_CACHE})`);
  } else {
    log('Phase1', 'Analyzing codebase...');
    const { cost } = await runClaude({
      prompt: buildAnalysisPrompt(),
      systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      cwd: CODEBASE_PATH,
      tools: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
      budget: BUDGET * 0.3,
      phase: 'Phase1',
    });
    totalCost += cost;

    if (!fs.existsSync(TESTER_CACHE)) {
      console.error('Phase 1 failed — TESTER.md not generated');
      process.exit(1);
    }
  }

  const testerMd = fs.readFileSync(TESTER_CACHE, 'utf-8');
  const codeFaults = parseCodeFaults(testerMd);
  log('Phase1', `TESTER.md loaded (${testerMd.length} chars)`);

  // Phase 2: Agentic browser testing
  log('Phase2', 'Opening browser...');
  const initResult = await runClaude({
    prompt: `Run: agent-browser open ${BASE_URL} && agent-browser wait --load networkidle && echo "Browser ready"`,
    systemPrompt: 'Open the browser and wait for page load.',
    cwd: ARTIFACT_DIR,
    tools: ['Bash'],
    budget: 0.1,
    phase: 'BrowserInit',
    verbose: false,
  });
  totalCost += initResult.cost;

  log('Phase2', 'Running tests with state backtracking...');
  const { result: testOutput, cost: testCost } = await runClaude({
    prompt: buildTestPrompt(testerMd, codeFaults, SCREENSHOT_DIR),
    systemPrompt: TESTING_SYSTEM_PROMPT,
    cwd: ARTIFACT_DIR,
    tools: ['Bash', 'Read', 'Write'],
    budget: BUDGET * 0.9,
    phase: 'Testing',
  });
  totalCost += testCost;

  // Close browser
  log('Cleanup', 'Closing browser...');
  const closeResult = await runClaude({
    prompt: 'Run: agent-browser close',
    systemPrompt: 'Close browser.',
    cwd: ARTIFACT_DIR,
    tools: ['Bash'],
    budget: 0.05,
    phase: 'Cleanup',
    verbose: false,
  });
  totalCost += closeResult.cost;

  // Write final summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log('Done', `Total cost: $${totalCost.toFixed(4)} | Duration: ${duration}s`);
  log('Done', `Artifacts: ${ARTIFACT_DIR}`);
  log('Done', `Screenshots: ${SCREENSHOT_DIR}`);

  // Save the raw test output
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'raw-output.txt'), testOutput);
  log('Done', 'Raw output saved to raw-output.txt');

  // Print screenshots
  if (fs.existsSync(SCREENSHOT_DIR)) {
    const screenshots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    log('Done', `${screenshots.length} screenshots captured`);
  }

  // Print test notes if generated
  const notesPath = path.join(ARTIFACT_DIR, 'test-notes.md');
  if (fs.existsSync(notesPath)) {
    console.log('\n=== TEST NOTES ===');
    console.log(fs.readFileSync(notesPath, 'utf-8'));
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
