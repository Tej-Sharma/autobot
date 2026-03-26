/**
 * Agentic test runner — runs directly on the Render worker.
 *
 * Uses Playwright for browser automation + Anthropic Claude API (vision + tools)
 * to autonomously explore and test a web application.
 *
 * Strategy: at each page/state, exhaust all testable features before moving on.
 * When multiple state-changing paths exist, mark a backtrack point, pick one,
 * and return later to try the others. Tracks every step with checklists and logs.
 */

import Anthropic from "@anthropic-ai/sdk";
import { chromium, Page } from "playwright";
import { AiTestReport, AiTestFinding, TrackedStep } from "./types";
import { CONFIG } from "./config";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ */
/*  Tool definitions for Claude                                        */
/* ------------------------------------------------------------------ */

const TOOLS: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Navigate the browser to a URL (full or relative path).",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "URL or path like /login, /dashboard",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description:
      "Click an interactive element by its index from the elements list.",
    input_schema: {
      type: "object" as const,
      properties: {
        index: {
          type: "number",
          description: "Element index from the interactive elements list",
        },
      },
      required: ["index"],
    },
  },
  {
    name: "fill",
    description: "Clear and type text into an input element.",
    input_schema: {
      type: "object" as const,
      properties: {
        index: { type: "number", description: "Element index" },
        value: { type: "string", description: "Text to type" },
      },
      required: ["index", "value"],
    },
  },
  {
    name: "select_option",
    description: "Select an option in a dropdown by value or label.",
    input_schema: {
      type: "object" as const,
      properties: {
        index: { type: "number" },
        value: { type: "string" },
      },
      required: ["index", "value"],
    },
  },
  {
    name: "scroll",
    description: "Scroll the page up or down by one viewport height.",
    input_schema: {
      type: "object" as const,
      properties: {
        direction: { type: "string", enum: ["down", "up"] },
      },
      required: ["direction"],
    },
  },
  {
    name: "press_key",
    description:
      "Press a keyboard key (Enter, Tab, Escape, Backspace, etc.).",
    input_schema: {
      type: "object" as const,
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "report_bug",
    description:
      "Report a bug or issue found during testing. Use this whenever you discover something wrong.",
    input_schema: {
      type: "object" as const,
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
        },
        category: {
          type: "string",
          description:
            "e.g. ui, functional, security, accessibility, performance",
        },
        message: { type: "string", description: "Clear bug description" },
      },
      required: ["severity", "category", "message"],
    },
  },
  {
    name: "log_step",
    description:
      "Log what you tested at the current page/state. Call this AFTER you have exhausted all testable features at the current state before moving on. This tracks your progress through the app.",
    input_schema: {
      type: "object" as const,
      properties: {
        stepName: {
          type: "string",
          description:
            "Short label for this state, e.g. 'Homepage', 'Registration form', 'Dashboard settings'",
        },
        actions: {
          type: "array",
          items: { type: "string" },
          description:
            "List of what you did here, e.g. ['Submitted empty form', 'Tested XSS in email field', 'Clicked all nav links']",
        },
        checklist: {
          type: "array",
          items: {
            type: "object" as const,
            properties: {
              item: { type: "string", description: "What was checked" },
              passed: { type: "boolean", description: "true if the check passed, false if it failed" },
              notes: { type: "string", description: "Optional observation" },
            },
            required: ["item", "passed"],
          },
          description: "Checklist of items verified at this step",
        },
        observations: {
          type: "string",
          description: "General observations about this page/state",
        },
        hasMultiplePaths: {
          type: "boolean",
          description:
            "Set to true if there are multiple state-changing actions possible here (e.g. multiple nav links, different form submissions). This saves a backtrack point so you can return later to try the other paths.",
        },
      },
      required: ["stepName", "actions", "checklist", "observations", "hasMultiplePaths"],
    },
  },
  {
    name: "backtrack",
    description:
      "Navigate back to the most recent backtrack point to try an unexplored path. Call this when you've finished exploring a branch and want to return to try alternatives.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why you are backtracking, e.g. 'Finished testing signup flow, returning to try login flow'",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "finish_testing",
    description:
      "Call when testing is complete — either found 5+ bugs or exhausted all testable features and backtrack points.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "Summary of what was tested" },
      },
      required: ["summary"],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Element snapshot — assigns data-aid attributes for reliable clicks */
/* ------------------------------------------------------------------ */

interface ElementInfo {
  index: number;
  tag: string;
  type: string;
  text: string;
  placeholder: string;
  ariaLabel: string;
  href: string;
  role: string;
  name: string;
}

async function snapshotElements(page: Page): Promise<ElementInfo[]> {
  return page.evaluate(() => {
    // Clean up old markers
    document
      .querySelectorAll("[data-aid]")
      .forEach((el) => el.removeAttribute("data-aid"));

    const results: Array<{
      index: number;
      tag: string;
      type: string;
      text: string;
      placeholder: string;
      ariaLabel: string;
      href: string;
      role: string;
      name: string;
    }> = [];
    const seen = new Set<string>();

    document
      .querySelectorAll(
        'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="menuitem"]',
      )
      .forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return;
        if (rect.bottom < -100 || rect.top > window.innerHeight * 3) return;

        const htmlEl = el as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") || "";
        const text = (htmlEl.innerText || htmlEl.textContent || "")
          .trim()
          .slice(0, 80)
          .replace(/\n+/g, " ");
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const href = el.getAttribute("href") || "";
        const role = el.getAttribute("role") || "";
        const name = el.getAttribute("name") || "";

        const key = `${tag}|${type}|${text.slice(0, 30)}|${placeholder}|${href}|${name}|${ariaLabel}`;
        if (seen.has(key)) return;
        seen.add(key);

        const idx = results.length;
        el.setAttribute("data-aid", String(idx));

        results.push({
          index: idx,
          tag,
          type,
          text,
          placeholder,
          ariaLabel,
          href,
          role,
          name,
        });
      });

    return results.slice(0, 60); // cap to keep context manageable
  });
}

function formatElements(elements: ElementInfo[]): string {
  if (!elements.length) return "No interactive elements found on this page.";

  return elements
    .map((el) => {
      let desc = `[${el.index}] ${el.tag}`;
      if (el.type) desc += `[${el.type}]`;
      if (el.role) desc += `(role=${el.role})`;
      if (el.text) desc += ` "${el.text}"`;
      if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
      if (el.ariaLabel) desc += ` aria-label="${el.ariaLabel}"`;
      if (el.href && el.href !== "#")
        desc += ` → ${el.href.slice(0, 60)}`;
      return desc;
    })
    .join("\n");
}

/* ------------------------------------------------------------------ */
/*  Screenshot helper                                                  */
/* ------------------------------------------------------------------ */

async function takeScreenshot(
  page: Page,
  dir: string,
  index: number,
  label = "",
): Promise<{ filename: string; base64: string }> {
  const filename = `agentic-${String(index).padStart(3, "0")}${label ? `-${label}` : ""}.png`;
  const filepath = path.join(dir, filename);
  await fs.promises.mkdir(dir, { recursive: true });
  await page.screenshot({ path: filepath, fullPage: false });
  const data = fs.readFileSync(filepath);
  return { filename, base64: data.toString("base64") };
}

/* ------------------------------------------------------------------ */
/*  Backtrack stack                                                    */
/* ------------------------------------------------------------------ */

interface BacktrackEntry {
  stepId: string;
  stepName: string;
  url: string;
}

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(
  baseUrl: string,
  credentials?: Record<string, string>,
): string {
  let prompt = `You are a destructive QA tester. Your job is to BREAK ${baseUrl} and find every flaw. You are harsh and critical — nothing is "good enough." Every app has bugs.

## CRITICAL RULES — YOU MUST FOLLOW THESE
1. After testing a page, you MUST call \`log_step\` to record what you did. Do this every 3-4 actions, not at the end.
2. When you find ANY issue, you MUST call \`report_bug\` IMMEDIATELY. Do not wait.
3. When a page has multiple navigation paths, call \`log_step\` with hasMultiplePaths=true BEFORE clicking away.
4. After finishing a branch, you MUST call \`backtrack\` to return and try other paths. DO NOT skip backtracking.
5. After 5+ bugs OR all paths tested AND all backtrack points exhausted, call \`finish_testing\`.

## Testing Each Page — Be Destructive
At each page, TRY TO BREAK things:
- Scroll the full page. Look for: cut-off text, overlapping elements, missing images, inconsistent spacing, poor alignment
- Test forms destructively: submit empty, paste garbage, use "'; DROP TABLE--", "<script>alert(1)</script>", 500+ character strings
- Click every button and link. Does it respond? Is there feedback? Loading state?
- If you can create/edit something (node, canvas, item): create one, then try to edit its title with special characters, try to delete it, try empty names, try very long names
- Try to use features that should fail: empty searches, actions without required data
- Check every modal/dropdown: does it close properly? Can you open two at once?

## You MUST Find Bugs — Look For These Specifically
- Missing loading states or spinners when actions take time
- Buttons that don't give feedback when clicked (no hover state, no loading)
- Forms/inputs without placeholder text or labels
- Empty states that say nothing useful (blank pages with no guidance)
- Inconsistent spacing, font sizes, or colors between similar elements
- Features that silently fail (you click but nothing happens, no error shown)
- Missing keyboard navigation or focus indicators
- Text that overflows its container or gets truncated without ellipsis
- Images without alt text
- Modals that can't be closed with Escape key
- Error messages that are too technical or unhelpful

## Backtracking — MANDATORY
When you set a backtrack point, you MUST eventually call \`backtrack\` to return. After testing one path from a branch point, call \`backtrack\` to go back and test the other paths. If you finish without backtracking to your saved points, you have failed your job.

## Your Workflow Per Page
1. Observe screenshot + elements (2-3 seconds of analysis)
2. Test 3-4 things on this page
3. Call \`report_bug\` for each issue — be harsh, report even minor problems
4. Call \`log_step\` to record progress
5. Continue testing OR navigate to next page OR \`backtrack\`

You MUST report at least 3 bugs. If you haven't found any after 10 turns, you are not looking hard enough. Report spacing issues, missing hover states, unclear labels — ANYTHING imperfect.`;

  if (credentials && Object.keys(credentials).length > 0) {
    prompt += `\n\n## Test Credentials — LOG IN QUICKLY\n`;
    for (const [key, value] of Object.entries(credentials)) {
      prompt += `${key}: ${value}\n`;
    }
    prompt += `\nLog in with these credentials within the first 3 turns. Do NOT spend many turns testing the login page — the real value is testing the app AFTER login. Once logged in:
- Actually USE every feature you find. Don't just open pages — interact with them.
- Create things (canvases, nodes, items), then edit them, rename them, try to break them.
- Type into text areas, submit forms, use search, test filters.
- Try to trigger errors: empty inputs, special characters, extremely long text.
- Test the full user journey: create → edit → delete → verify.`;
  } else {
    prompt +=
      "\n\nNo credentials provided. Test only public/unauthenticated features.";
  }

  return prompt;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

export async function runAgenticTest(input: {
  baseUrl: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  jobId: string;
  maxTurns?: number;
}): Promise<AiTestReport> {
  const { baseUrl, credentials, screenshotDir } = input;
  const startTime = Date.now();

  console.log(`[agentic] starting test for ${baseUrl} (model: ${CONFIG.agentModel})`);
  const client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const findings: AiTestFinding[] = [];
  const screenshotKeys: string[] = [];
  const trackedSteps: TrackedStep[] = [];
  const backtrackStack: BacktrackEntry[] = [];
  const backtrackLog: { from: string; to: string; reason: string }[] = [];
  let stepCounter = 0;
  let currentStepId = ""; // tracks the most recently logged step
  let screenshotIdx = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const systemPrompt = buildSystemPrompt(baseUrl, credentials);
  let elementCache: ElementInfo[] = [];

  try {
    // Navigate to start
    await page.goto(baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(1000);

    const shot = await takeScreenshot(
      page,
      screenshotDir,
      screenshotIdx++,
      "initial",
    );
    screenshotKeys.push(shot.filename);
    elementCache = await snapshotElements(page);
    console.log(`[agentic] initial screenshot taken, ${elementCache.length} elements found`);

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Testing ${baseUrl}\n\nCurrent URL: ${page.url()}\n\nInteractive elements:\n${formatElements(elementCache)}\n\nStart testing this page. Your workflow:\n1. Scroll down to see the full page\n2. Test interactive elements (click buttons, test forms)\n3. Call report_bug for any issues you find\n4. Call log_step to record what you tested\n5. Then navigate to the next page\n\nRemember: you MUST call log_step and report_bug. Begin now.`,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: shot.base64,
            },
          },
        ],
      },
    ];

    const MAX_TURNS = input.maxTurns ?? 25;
    const KEEP_RECENT_TURNS = 2;
    let done = false;
    let lastStructuredTool = -1; // track when log_step/report_bug was last called
    const NUDGE_INTERVAL = 3; // remind agent every N turns if no structured tool calls

    for (let turn = 0; turn < MAX_TURNS && !done; turn++) {
      // Sliding window: strip base64 images from older messages to prevent OOM.
      if (messages.length > KEEP_RECENT_TURNS * 2 + 1) {
        const cutoff = messages.length - KEEP_RECENT_TURNS * 2;
        for (let i = 0; i < cutoff; i++) {
          const msg = messages[i];
          if (Array.isArray(msg.content)) {
            messages[i] = {
              ...msg,
              content: (msg.content as Anthropic.ContentBlockParam[]).map(
                (block) => {
                  if (
                    block.type === "image" ||
                    (block.type === "tool_result" &&
                      Array.isArray((block as Anthropic.ToolResultBlockParam).content))
                  ) {
                    if (block.type === "tool_result") {
                      const tr = block as Anthropic.ToolResultBlockParam;
                      return {
                        ...tr,
                        content: (tr.content as Anthropic.ContentBlockParam[]).filter(
                          (c) => c.type !== "image",
                        ),
                      } as Anthropic.ToolResultBlockParam;
                    }
                    return { type: "text" as const, text: "[screenshot omitted]" };
                  }
                  return block;
                },
              ),
            };
          }
        }
      }

      console.log(`[agentic] turn ${turn + 1}/${MAX_TURNS}, calling Claude... (msgs: ${messages.length})`);
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: CONFIG.agentModel,
          max_tokens: 2048,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        });
      } catch (apiErr) {
        console.error(`[agentic] API error on turn ${turn}:`, apiErr);
        break;
      }

      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      console.log(`[agentic] turn ${turn + 1}: ${response.stop_reason}, ${response.content.length} blocks, ${response.usage?.output_tokens ?? 0} out tokens`);

      // Add assistant response
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        if (response.stop_reason === "end_turn") break;
        continue;
      }

      // Execute tools and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        const inp = tu.input as Record<string, unknown>;
        let resultText = "";
        let takeNewShot = true;

        try {
          switch (tu.name) {
            case "navigate": {
              let url = String(inp.url || "");
              if (url.startsWith("/"))
                url = baseUrl.replace(/\/$/, "") + url;
              await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
              });
              await page
                .waitForLoadState("networkidle", { timeout: 8000 })
                .catch(() => {});
              await page.waitForTimeout(500);
              resultText = `Navigated to ${page.url()}`;
              break;
            }

            case "click": {
              const idx = Number(inp.index);
              if (idx < 0 || idx >= elementCache.length) {
                resultText = `Error: index ${idx} out of range (0-${elementCache.length - 1})`;
                takeNewShot = false;
                break;
              }
              try {
                const locator = page.locator(`[data-aid="${idx}"]`).first();
                await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
                await locator.click({ timeout: 5000 });
                await page.waitForTimeout(800);
                const el = elementCache[idx];
                resultText = `Clicked [${idx}] ${el.tag} "${el.text || el.placeholder || el.ariaLabel}"`;
              } catch (err) {
                resultText = `Click failed on [${idx}]: ${err instanceof Error ? err.message : String(err)}`;
              }
              break;
            }

            case "fill": {
              const idx = Number(inp.index);
              const value = String(inp.value || "");
              if (idx < 0 || idx >= elementCache.length) {
                resultText = `Error: index ${idx} out of range`;
                takeNewShot = false;
                break;
              }
              try {
                const locator = page.locator(`[data-aid="${idx}"]`).first();
                await locator.fill(value, { timeout: 5000 });
                await page.waitForTimeout(300);
                resultText = `Filled [${idx}] with "${value}"`;
              } catch (err) {
                resultText = `Fill failed on [${idx}]: ${err instanceof Error ? err.message : String(err)}`;
              }
              break;
            }

            case "select_option": {
              const idx = Number(inp.index);
              const value = String(inp.value || "");
              if (idx < 0 || idx >= elementCache.length) {
                resultText = `Error: index ${idx} out of range`;
                takeNewShot = false;
                break;
              }
              try {
                const locator = page.locator(`[data-aid="${idx}"]`).first();
                await locator.selectOption(value, { timeout: 5000 });
                resultText = `Selected "${value}" in [${idx}]`;
              } catch (err) {
                resultText = `Select failed: ${err instanceof Error ? err.message : String(err)}`;
              }
              break;
            }

            case "scroll": {
              const dir = String(inp.direction);
              if (dir === "down") {
                await page.evaluate(() =>
                  window.scrollBy(0, window.innerHeight * 0.8),
                );
              } else {
                await page.evaluate(() =>
                  window.scrollBy(0, -window.innerHeight * 0.8),
                );
              }
              await page.waitForTimeout(500);
              resultText = `Scrolled ${dir}`;
              break;
            }

            case "press_key": {
              const key = String(inp.key);
              await page.keyboard.press(key);
              await page.waitForTimeout(500);
              resultText = `Pressed ${key}`;
              break;
            }

            case "report_bug": {
              const finding: AiTestFinding = {
                severity:
                  (inp.severity as AiTestFinding["severity"]) || "medium",
                category: String(inp.category || "general"),
                message: String(inp.message || ""),
                stepId: currentStepId || undefined,
              };
              if (screenshotKeys.length > 0) {
                finding.screenshot =
                  screenshotKeys[screenshotKeys.length - 1];
              }
              findings.push(finding);

              // Also attach bug to the most recent tracked step
              if (trackedSteps.length > 0) {
                trackedSteps[trackedSteps.length - 1].bugsFound.push(finding);
              }

              resultText = `Bug #${findings.length} reported: [${finding.severity}] ${finding.message}`;
              lastStructuredTool = turn;
              if (findings.length >= 5) {
                resultText +=
                  "\n\nYou have found 5 bugs. Call finish_testing now with a summary.";
              }
              takeNewShot = false;
              break;
            }

            case "log_step": {
              stepCounter++;
              const stepId = `step-${String(stepCounter).padStart(3, "0")}`;
              currentStepId = stepId;
              const stepName = String(inp.stepName || "Unnamed step");
              const actions = Array.isArray(inp.actions)
                ? (inp.actions as string[])
                : [];
              const checklist = Array.isArray(inp.checklist)
                ? (inp.checklist as { item: string; passed: boolean; notes?: string }[])
                : [];
              const observations = String(inp.observations || "");
              const hasMultiplePaths = Boolean(inp.hasMultiplePaths);

              const step: TrackedStep = {
                id: stepId,
                name: stepName,
                url: page.url(),
                actions,
                checklist,
                observations,
                bugsFound: [],
                screenshotKey: screenshotKeys.length > 0
                  ? screenshotKeys[screenshotKeys.length - 1]
                  : undefined,
                isBacktrackPoint: hasMultiplePaths,
                backtrackExhausted: false,
              };
              trackedSteps.push(step);
              lastStructuredTool = turn;

              if (hasMultiplePaths) {
                backtrackStack.push({
                  stepId,
                  stepName,
                  url: page.url(),
                });
                console.log(`[agentic] backtrack point saved: ${stepId} "${stepName}" at ${page.url()}`);
              }

              console.log(`[agentic] step logged: ${stepId} "${stepName}" (${actions.length} actions, ${checklist.length} checks, backtrack: ${hasMultiplePaths})`);

              resultText = `Step ${stepId} "${stepName}" logged.`;
              resultText += `\n${checklist.filter(c => c.passed).length}/${checklist.length} checks passed.`;
              if (hasMultiplePaths) {
                resultText += `\nBacktrack point saved. When you finish exploring this branch, call backtrack to return here and try other paths.`;
              }
              if (backtrackStack.length > 0) {
                resultText += `\n\nPending backtrack points: ${backtrackStack.map(b => `"${b.stepName}"`).join(", ")}`;
              }
              takeNewShot = false;
              break;
            }

            case "backtrack": {
              const reason = String(inp.reason || "");

              if (backtrackStack.length === 0) {
                resultText = "No backtrack points available. Continue testing or call finish_testing.";
                takeNewShot = false;
                break;
              }

              const entry = backtrackStack.pop()!;

              // Mark the step as exhausted
              const btStep = trackedSteps.find(s => s.id === entry.stepId);
              if (btStep) btStep.backtrackExhausted = true;

              const fromUrl = page.url();
              backtrackLog.push({
                from: fromUrl,
                to: entry.url,
                reason,
              });

              console.log(`[agentic] backtracking from ${fromUrl} to ${entry.url} (step: ${entry.stepId} "${entry.stepName}")`);

              // Navigate back
              await page.goto(entry.url, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
              });
              await page
                .waitForLoadState("networkidle", { timeout: 8000 })
                .catch(() => {});
              await page.waitForTimeout(500);

              resultText = `Backtracked to "${entry.stepName}" (${entry.url}). You're back at this branching point. Try the next unexplored path.`;
              if (backtrackStack.length > 0) {
                resultText += `\n\nRemaining backtrack points: ${backtrackStack.map(b => `"${b.stepName}"`).join(", ")}`;
              } else {
                resultText += `\n\nNo more backtrack points remaining.`;
              }
              // takeNewShot = true (default) — will take a screenshot of the backtracked page
              break;
            }

            case "finish_testing": {
              resultText = "Testing complete.";
              done = true;
              takeNewShot = false;
              break;
            }

            default:
              resultText = `Unknown tool: ${tu.name}`;
              takeNewShot = false;
          }
        } catch (execErr) {
          resultText = `Execution error: ${execErr instanceof Error ? execErr.message : String(execErr)}`;
        }

        // Take new screenshot after browser actions
        if (takeNewShot) {
          try {
            const newShot = await takeScreenshot(
              page,
              screenshotDir,
              screenshotIdx++,
            );
            screenshotKeys.push(newShot.filename);
            elementCache = await snapshotElements(page);

            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: [
                {
                  type: "text",
                  text: `${resultText}\n\nCurrent URL: ${page.url()}\n\nInteractive elements:\n${formatElements(elementCache)}`,
                },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: newShot.base64,
                  },
                },
              ],
            });
          } catch {
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: resultText,
            });
          }
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: resultText,
          });
        }
      }

      if (toolResults.length > 0 && !done) {
        // Inject periodic nudge if agent hasn't called log_step/report_bug recently
        const turnsSinceStructured = turn - lastStructuredTool;
        if (turnsSinceStructured >= NUDGE_INTERVAL && turnsSinceStructured % NUDGE_INTERVAL === 0) {
          const turnsLeft = MAX_TURNS - turn - 1;
          let nudge = `\n\n⚠️ REMINDER: You have ${turnsLeft} turns left. Do NOT waste turns — you must call log_step and report_bug NOW.`;
          if (trackedSteps.length === 0) {
            nudge += ` You have NOT called log_step yet. Call log_step on your NEXT action to record what you've tested.`;
          }
          if (findings.length === 0) {
            nudge += ` You have NOT reported any bugs. Every app has issues — report UX problems, missing labels, poor contrast, unclear error messages, anything imperfect. Call report_bug NOW.`;
          }
          if (turnsLeft <= 5) {
            nudge += ` You are almost out of turns! Call report_bug for issues and log_step immediately, then finish_testing.`;
          }
          // Append nudge to the last tool result's text
          const lastResult = toolResults[toolResults.length - 1];
          if (typeof lastResult.content === "string") {
            lastResult.content += nudge;
          } else if (Array.isArray(lastResult.content)) {
            const textBlock = (lastResult.content as Anthropic.ContentBlockParam[]).find(
              (b) => b.type === "text",
            ) as Anthropic.TextBlockParam | undefined;
            if (textBlock) textBlock.text += nudge;
          }
        }
        messages.push({ role: "user", content: toolResults });
      }

      // Budget guard
      const costSoFar = estimateCost(inputTokens, outputTokens);
      if (costSoFar > CONFIG.aiTestBudgetUsd) {
        console.log(
          `[agentic] budget exceeded ($${costSoFar.toFixed(2)} > $${CONFIG.aiTestBudgetUsd}), stopping`,
        );
        break;
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const durationMs = Date.now() - startTime;
  const costUsd = estimateCost(inputTokens, outputTokens);

  // Derive flow counts from backtrack points
  const flowSegments = trackedSteps.filter(s => s.isBacktrackPoint).length + 1;
  const flowsWithBugs = new Set(findings.map(f => f.stepId).filter(Boolean)).size;

  const reportMd = buildReportMd(
    findings,
    baseUrl,
    durationMs,
    costUsd,
    screenshotKeys,
    trackedSteps,
    backtrackLog,
  );

  console.log(
    `[agentic] done: ${findings.length} findings, ${trackedSteps.length} steps, ${backtrackLog.length} backtracks, ${screenshotKeys.length} screenshots, $${costUsd.toFixed(4)}, ${(durationMs / 1000).toFixed(1)}s`,
  );

  return {
    status:
      findings.some(
        (f) => f.severity === "critical" || f.severity === "high",
      )
        ? "fail"
        : findings.length > 0
          ? "partial"
          : "pass",
    flowsTotal: flowSegments,
    flowsPassed: flowSegments - flowsWithBugs,
    flowsFailed: flowsWithBugs,
    flowsSkipped: backtrackStack.length, // remaining unexplored backtrack points
    codeFaults: 0,
    findings,
    costUsd,
    durationMs,
    reportMd,
    screenshotKeys,
    steps: trackedSteps,
    backtrackLog,
  };
}

/* ------------------------------------------------------------------ */
/*  Cost estimation                                                    */
/* ------------------------------------------------------------------ */

function estimateCost(inTok: number, outTok: number): number {
  const model = CONFIG.agentModel;
  // Haiku: $0.80 / $4.00 per MTok, Sonnet: $3 / $15 per MTok
  const isHaiku = model.includes("haiku");
  const inRate = isHaiku ? 0.8 / 1_000_000 : 3.0 / 1_000_000;
  const outRate = isHaiku ? 4.0 / 1_000_000 : 15.0 / 1_000_000;
  return inTok * inRate + outTok * outRate;
}

/* ------------------------------------------------------------------ */
/*  Report markdown                                                    */
/* ------------------------------------------------------------------ */

function buildReportMd(
  findings: AiTestFinding[],
  baseUrl: string,
  durationMs: number,
  costUsd: number,
  screenshots: string[],
  steps: TrackedStep[],
  btLog: { from: string; to: string; reason: string }[],
): string {
  let md = `# AI Agentic Test Report\n\n`;
  md += `**Target:** ${baseUrl}\n`;
  md += `**Duration:** ${(durationMs / 1000).toFixed(1)}s\n`;
  md += `**Cost:** $${costUsd.toFixed(4)}\n`;
  md += `**Screenshots taken:** ${screenshots.length}\n`;
  md += `**Steps completed:** ${steps.length}\n`;
  md += `**Backtracks:** ${btLog.length}\n\n`;

  // --- Test Execution Log ---
  if (steps.length > 0) {
    md += `## Test Execution Log\n\n`;
    for (const step of steps) {
      const btLabel = step.isBacktrackPoint
        ? ` (backtrack point${step.backtrackExhausted ? " — exhausted" : " — pending"})`
        : "";
      md += `### ${step.id}: ${step.name}${btLabel}\n`;
      md += `**URL:** ${step.url}\n\n`;

      if (step.actions.length > 0) {
        md += `**Actions:**\n`;
        for (const action of step.actions) {
          md += `- ${action}\n`;
        }
        md += `\n`;
      }

      if (step.checklist.length > 0) {
        const passed = step.checklist.filter(c => c.passed).length;
        md += `**Checklist (${passed}/${step.checklist.length} passed):**\n`;
        for (const check of step.checklist) {
          const icon = check.passed ? "[x]" : "[ ]";
          md += `- ${icon} ${check.item}`;
          if (check.notes) md += ` — ${check.notes}`;
          md += `\n`;
        }
        md += `\n`;
      }

      if (step.observations) {
        md += `**Observations:** ${step.observations}\n\n`;
      }

      if (step.bugsFound.length > 0) {
        md += `**Bugs found:** ${step.bugsFound.length}\n`;
        for (const bug of step.bugsFound) {
          md += `- [${bug.severity}] ${bug.category}: ${bug.message}\n`;
        }
        md += `\n`;
      }

      md += `---\n\n`;
    }
  }

  // --- Backtrack Log ---
  if (btLog.length > 0) {
    md += `## Backtrack Log\n\n`;
    for (let i = 0; i < btLog.length; i++) {
      md += `${i + 1}. ${btLog[i].reason}\n`;
      md += `   From: ${btLog[i].from} → To: ${btLog[i].to}\n`;
    }
    md += `\n`;
  }

  // --- Findings Summary ---
  if (findings.length === 0) {
    md += `## Result: PASS\n\nNo bugs found during testing.\n`;
  } else {
    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    md += `## Result: ${hasCritical ? "FAIL" : "PARTIAL"}\n\n`;
    md += `Found ${findings.length} issue(s):\n\n`;
    md += `| # | Severity | Category | Description | Step | Screenshot |\n`;
    md += `|---|----------|----------|-------------|------|------------|\n`;
    findings.forEach((f, i) => {
      md += `| ${i + 1} | ${f.severity} | ${f.category} | ${f.message} | ${f.stepId || "N/A"} | ${f.screenshot || "N/A"} |\n`;
    });
  }

  return md;
}
