/**
 * Agentic test runner — runs directly on the Render worker.
 *
 * Uses Playwright for browser automation + Anthropic Claude API (vision + tools)
 * to autonomously explore and test a web application.
 *
 * Strategy: exhaust edge cases on current page before advancing,
 * backtrack to cover features, stop after 3 bugs found.
 */

import Anthropic from "@anthropic-ai/sdk";
import { chromium, Page } from "playwright";
import { AiTestReport, AiTestFinding } from "./types";
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
    name: "finish_testing",
    description:
      "Call when testing is complete — either found 3+ bugs or exhausted all testable features.",
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
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(
  baseUrl: string,
  credentials?: Record<string, string>,
): string {
  let prompt = `You are an expert QA tester. You test web applications by interacting with them in a real browser.

## Your Goal
Find bugs, broken features, and UI issues at ${baseUrl}.

## Testing Strategy
- **Exhaust current state before advancing**: Before any action that changes page state (login, navigate, submit), test ALL edge cases on the current page first.
  Example: on a login page, try empty submit, invalid email, wrong password BEFORE logging in successfully.
- **Backtrack to cover all features**: After testing a flow, navigate back and explore other paths you haven't tested.
- **Error threshold**: If you discover 3 distinct bugs, STOP testing immediately by calling finish_testing.

## How This Works
1. You see a screenshot of the current page and a numbered list of interactive elements.
2. Use tools to interact: click(index), fill(index, value), navigate(url), scroll(direction), press_key(key).
3. After each action, you'll see the updated screenshot and elements.
4. When you find a bug, call report_bug.
5. When done (3 bugs found OR all major features tested), call finish_testing.

## What Counts as a Bug
- Broken links (404, error pages, dead ends)
- UI glitches (overlapping text, broken layouts, cut-off content)
- Non-functional buttons or forms
- Missing error messages for invalid input
- JavaScript errors visible on page
- Security issues (exposed data, missing auth guards)
- Accessibility problems (missing labels, poor contrast)
- Unexpected behavior (wrong redirects, data not saving)`;

  if (credentials && Object.keys(credentials).length > 0) {
    prompt += `\n\n## Test Credentials\n`;
    for (const [key, value] of Object.entries(credentials)) {
      prompt += `${key}: ${value}\n`;
    }
    prompt +=
      "\nUse these to test authenticated features. But FIRST test edge cases on the auth page before logging in.";
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
            text: `Testing ${baseUrl}\n\nCurrent URL: ${page.url()}\n\nInteractive elements:\n${formatElements(elementCache)}\n\nBegin testing. Start by exploring the current page.`,
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

    const MAX_TURNS = 40;
    let done = false;

    for (let turn = 0; turn < MAX_TURNS && !done; turn++) {
      console.log(`[agentic] turn ${turn + 1}/${MAX_TURNS}, calling Claude...`);
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: CONFIG.agentModel,
          max_tokens: 1024,
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
              };
              if (screenshotKeys.length > 0) {
                finding.screenshot =
                  screenshotKeys[screenshotKeys.length - 1];
              }
              findings.push(finding);
              resultText = `Bug #${findings.length} reported: [${finding.severity}] ${finding.message}`;
              if (findings.length >= 3) {
                resultText +=
                  "\n\nYou have found 3 bugs. Call finish_testing now with a summary.";
              }
              takeNewShot = false;
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
  const reportMd = buildReportMd(
    findings,
    baseUrl,
    durationMs,
    costUsd,
    screenshotKeys,
  );

  console.log(
    `[agentic] done: ${findings.length} findings, ${screenshotKeys.length} screenshots, $${costUsd.toFixed(4)}, ${(durationMs / 1000).toFixed(1)}s`,
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
    flowsTotal: 1,
    flowsPassed: findings.length === 0 ? 1 : 0,
    flowsFailed: findings.length > 0 ? 1 : 0,
    flowsSkipped: 0,
    codeFaults: 0,
    findings,
    costUsd,
    durationMs,
    reportMd,
    screenshotKeys,
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
): string {
  let md = `# AI Agentic Test Report\n\n`;
  md += `**Target:** ${baseUrl}\n`;
  md += `**Duration:** ${(durationMs / 1000).toFixed(1)}s\n`;
  md += `**Cost:** $${costUsd.toFixed(4)}\n`;
  md += `**Screenshots taken:** ${screenshots.length}\n\n`;

  if (findings.length === 0) {
    md += `## Result: PASS\n\nNo bugs found during testing.\n`;
  } else {
    const hasCritical = findings.some(
      (f) => f.severity === "critical" || f.severity === "high",
    );
    md += `## Result: ${hasCritical ? "FAIL" : "PARTIAL"}\n\n`;
    md += `Found ${findings.length} issue(s):\n\n`;
    md += `| # | Severity | Category | Description | Screenshot |\n`;
    md += `|---|----------|----------|-------------|------------|\n`;
    findings.forEach((f, i) => {
      md += `| ${i + 1} | ${f.severity} | ${f.category} | ${f.message} | ${f.screenshot || "N/A"} |\n`;
    });
  }

  return md;
}
