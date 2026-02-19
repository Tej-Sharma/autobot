/**
 * Prompt engineering for the Script-Generation App Tester.
 *
 * Architecture: 3 LLM calls total
 *   Phase 1: Codebase analysis → TESTER.md           (reuses existing prompts)
 *   Phase 2: TESTER.md → Playwright .ts test scripts  (1 LLM call)
 *   Phase 3: Execute scripts (0 LLM calls) → screenshots + results JSON
 *   Phase 4: Evaluate all results                     (1 LLM call)
 *
 * This file provides prompts for Phase 2 (script generation) and Phase 4
 * (evaluation). Phase 1 reuses ANALYSIS_SYSTEM_PROMPT / buildAnalysisPrompt
 * from appTesterPrompts.ts. Phase 3 is pure Playwright execution.
 */

import type { ParsedFlow, FlowGroup } from "./appTesterPrompts";

/* ------------------------------------------------------------------ */
/*  Phase 2: Generate Playwright test scripts from TESTER.md           */
/* ------------------------------------------------------------------ */

export const SCRIPT_GEN_SYSTEM_PROMPT = `You are an expert QA engineer who writes Playwright test scripts.

Given a TESTER.md test plan, you generate self-contained TypeScript Playwright scripts that execute deterministic browser tests. Each script:

1. Navigates to pages
2. Interacts with elements (click, fill, scroll)
3. Takes screenshots at key checkpoints
4. Writes a structured results JSON when done

## Playwright patterns you MUST use:

\`\`\`typescript
import { chromium, type Browser, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Parse CLI args passed by the runner
const BASE_URL = process.argv[2];
const SCREENSHOT_DIR = process.argv[3];
const RESULTS_FILE = process.argv[4];

interface FlowResult {
  flowId: string;
  flowName: string;
  status: "pass" | "fail" | "skip";
  reason?: string;
  screenshots: string[];
  duration: number;
}

async function run(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const results: FlowResult[] = [];

  try {
    // ... test logic ...
  } finally {
    await browser.close();
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  }
}

run().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
\`\`\`

## Key rules:

- **Self-contained**: Each script imports playwright, launches browser, runs tests, closes browser
- **CLI args**: Scripts receive BASE_URL, SCREENSHOT_DIR, RESULTS_FILE as argv[2..4]
- **Screenshots**: Name them \`{prefix}-{NNN}-{description}.png\`, save to SCREENSHOT_DIR
- **Results JSON**: Write FlowResult[] array to RESULTS_FILE when done
- **Error handling**: Wrap each flow in try/catch — a failing flow should not abort other flows
- **Timeouts**: Use page.goto(url, { timeout: 15000, waitUntil: "networkidle" })
- **Selectors**: Prefer accessible selectors: page.getByRole(), page.getByText(), page.getByLabel()
- **Scrolling**: For page flows, use page.evaluate(() => window.scrollBy(0, window.innerHeight))
- **Backtracking**: After clicking a button that navigates away, use page.goto() to return
- **No assertions library**: Just use try/catch + manual checks. Report pass/fail in results JSON.
- **Wait for load**: After navigation, use page.waitForLoadState("networkidle").catch(() => {})

## For auth flows with credentials:
\`\`\`typescript
// Fill login form
await page.goto(BASE_URL + "/login");
await page.getByLabel("Email").fill(credentials.email);
await page.getByLabel("Password").fill(credentials.password);
await page.getByRole("button", { name: /sign in|log in|submit/i }).click();
await page.waitForURL("**/dashboard**", { timeout: 10000 });
\`\`\`

## For page scroll-through flows:
\`\`\`typescript
// Scroll through all sections
await page.goto(BASE_URL + route);
await screenshot(page, prefix, "initial");

// Scroll in increments
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.scrollBy(0, window.innerHeight));
  await page.waitForTimeout(300);
}
await screenshot(page, prefix, "scrolled-bottom");

// Click buttons and backtrack
for (const btnText of buttons) {
  try {
    const btn = page.getByRole("button", { name: btnText }).or(page.getByRole("link", { name: btnText }));
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click();
      await page.waitForTimeout(1000);
      await screenshot(page, prefix, \`clicked-\${btnText.toLowerCase().replace(/\\s+/g, "-")}\`);
      await page.goto(BASE_URL + route); // backtrack
    }
  } catch { /* button not found, continue */ }
}
\`\`\``;

/**
 * Build the prompt that asks the LLM to generate Playwright scripts from TESTER.md.
 *
 * Strategy: We generate one script per FlowGroup. This keeps scripts focused
 * and means a failure in one group doesn't affect others.
 */
export function buildScriptGenPrompt(input: {
  testerMd: string;
  groups: FlowGroup[];
  baseUrl: string;
  credentials?: Record<string, string>;
  mockEmail: string;
  screenshotDir: string;
  scriptDir: string;
}): string {
  const { testerMd, groups, baseUrl, credentials, mockEmail, screenshotDir, scriptDir } = input;

  const credSection = credentials
    ? `const credentials = ${JSON.stringify(credentials)};`
    : `const credentials = { email: "${mockEmail}", password: "TestPass123!" };`;

  const groupDescriptions = groups
    .map((g, i) => {
      const prefix = String(i + 1).padStart(2, "0");
      const flowList = g.flows
        .map((f) => {
          let desc = `  - ${f.id} (${f.kind}, ${f.priority}): ${f.name} — route: ${f.route}`;
          if (f.sections?.length) desc += `\n    sections: ${f.sections.join(", ")}`;
          if (f.buttons?.length) desc += `\n    buttons: ${f.buttons.join(", ")}`;
          if (f.chain?.length) desc += `\n    chain: ${f.chain.join(" → ")}`;
          desc += `\n    instructions:\n${f.content.split("\n").map(l => "      " + l).join("\n")}`;
          return desc;
        })
        .join("\n");

      return `### Group ${i + 1}: ${g.groupName} (${g.groupType})
Script file: ${scriptDir}/test-${prefix}-${g.groupType}.ts
Screenshot prefix: ${prefix}
Results file: ${scriptDir}/results-${prefix}.json
Flows:
${flowList}`;
    })
    .join("\n\n");

  return `Generate Playwright test scripts from this test plan.

## App URL
${baseUrl}

## Credentials
${credSection}

## Test Plan (TESTER.md)
---
${testerMd}
---

## Groups to generate scripts for:

${groupDescriptions}

## Instructions

Write ONE TypeScript Playwright script file per group using the Write tool.

Each script MUST:
1. Be a self-contained runnable file: \`npx playwright test <file>\` or \`npx tsx <file>\`
2. Accept CLI args: BASE_URL (argv[2]), SCREENSHOT_DIR (argv[3]), RESULTS_FILE (argv[4])
3. Import from "playwright" (NOT "@playwright/test" — we run with tsx, not playwright test runner)
4. Launch chromium headless, create context with 1280x720 viewport
5. Execute every flow assigned to that group
6. Take screenshots at key checkpoints (initial view, after scroll, after clicks, after form submit)
7. Write results JSON (FlowResult[]) to the results file
8. Close browser in a finally block
9. Handle errors per-flow (one flow failing shouldn't crash the script)

Screenshot naming: \`{prefix}-{NNN}-{description}.png\` where prefix is the group prefix (01, 02, etc.) and NNN is a counter (001, 002, ...).

Hardcode the credentials directly in each script (from the credentials section above).
Hardcode the BASE_URL fallback as "${baseUrl}" (overridable via argv).

For "rooted" groups: run prerequisite flows (login) first, then run each rooted flow.
For "page" flows: scroll through ALL listed sections, click ALL listed buttons, backtrack after each.
For "api" flows: use fetch() instead of browser to test endpoints.
For "sequential" flows: execute steps in order, each depending on previous.

Write the scripts now. One file per group.`;
}

/* ------------------------------------------------------------------ */
/*  Phase 4: Evaluate results                                          */
/* ------------------------------------------------------------------ */

export const EVAL_SYSTEM_PROMPT = `You are an expert QA evaluator. You review test execution results — screenshots, result JSONs, and code faults — to produce a comprehensive test report.

You look at screenshots to verify:
- Pages rendered correctly (no blank pages, no error screens, no broken layouts)
- Interactive elements responded (buttons, forms, navigation)
- Expected content is visible
- No visual regressions

You look at result JSONs to verify:
- Which flows passed/failed/skipped
- Error messages and failure reasons
- Timing data

You cross-reference against known code faults to check if they manifested during testing.`;

export function buildEvalPrompt(input: {
  artifactDir: string;
  screenshotDir: string;
  scriptDir: string;
  resultFiles: string[];
  codeFaults: string;
  baseUrl: string;
  totalFlows: number;
  skippedFlows: number;
}): string {
  const {
    artifactDir,
    screenshotDir,
    scriptDir,
    resultFiles,
    codeFaults,
    baseUrl,
    totalFlows,
    skippedFlows,
  } = input;

  return `Evaluate the test results and write reports.

App URL: ${baseUrl}
Total flows defined: ${totalFlows}
Flows skipped (no auth): ${skippedFlows}

## Result files to read:
${resultFiles.map((f) => `- ${f}`).join("\n")}

## Screenshots directory:
${screenshotDir}/
Read the screenshots to visually verify test outcomes.

## Code Faults (from static analysis):
${codeFaults || "None found."}

## Instructions

1. Read ALL result JSON files listed above
2. Read ALL screenshots in the screenshots directory
3. Cross-reference results against code faults
4. Write two reports:

### ${artifactDir}/agent-test-report.md
- Summary section (overall status, pass rate)
- Code faults summary (which were confirmed by testing)
- Test results table (each flow: pass/fail/skip with notes)
- Issues found during testing (severity, description, URL, screenshot reference)
- Routes tested
- Overall assessment paragraph

### ${artifactDir}/agent-test-report.json
\`\`\`json
{
  "status": "passed" | "partial" | "failed",
  "flowsTotal": ${totalFlows},
  "flowsPassed": <count>,
  "flowsFailed": <count>,
  "flowsSkipped": ${skippedFlows},
  "codeFaults": <count from static analysis>,
  "findings": [
    {
      "severity": "blocking" | "high" | "medium" | "low",
      "category": "string",
      "message": "string",
      "url": "string",
      "screenshot": "string"
    }
  ],
  "routesTested": ["..."],
  "summary": "one paragraph"
}
\`\`\``;
}
