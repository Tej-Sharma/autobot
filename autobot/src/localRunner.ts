/**
 * Standalone local test runner.
 *
 * Usage:
 *   npx tsx src/localRunner.ts <url> [options]
 *
 * Options:
 *   --routes home,pricing,features   Route keys or paths (default: CONFIG.defaultRoutes)
 *   --mode minimal|smoke|full        Screenshot mode (default: smoke)
 *   --viewports desktop,mobile       Viewport names (default: all configured)
 *   --no-judge                       Skip AI scoring
 *
 * Examples:
 *   npx tsx src/localRunner.ts http://localhost:8000
 *   npx tsx src/localRunner.ts http://localhost:3000 --routes home,pricing --mode full
 *   npx tsx src/localRunner.ts http://localhost:8000 --no-judge --viewports desktop
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "./config";
import { resolveRouteSpecs } from "./manifest";
import { runVisualChecks } from "./screenshotRunner";
import { judgeScreenshots } from "./judge";
import {
  aggregateRunTotals,
  writeJsonReport,
  writeMarkdownReport,
} from "./reporter";
import { normalizeBaseUrl, stableId, uniqueList } from "./utils";
import { RunMode, RunReport, ViewportSetting } from "./types";

/* ------------------------------------------------------------------ */
/*  CLI argument parsing                                               */
/* ------------------------------------------------------------------ */

function parseArgs(argv: string[]): {
  url: string;
  routes: string[];
  mode: RunMode;
  viewports: ViewportSetting[];
  includeJudge: boolean;
} {
  const args = argv.slice(2);

  if (!args.length || args[0].startsWith("--")) {
    console.error(
      "Usage: npx tsx src/localRunner.ts <url> [--routes r1,r2] [--mode smoke] [--viewports desktop] [--no-judge]",
    );
    process.exit(1);
  }

  const url = args[0];
  let routes = CONFIG.defaultRoutes;
  let mode: RunMode = CONFIG.defaultMode;
  let viewportNames: string[] | null = null;
  let includeJudge = CONFIG.defaultJudge;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--routes" && args[i + 1]) {
      routes = args[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--mode" && args[i + 1]) {
      const v = args[++i].toLowerCase();
      if (v === "minimal" || v === "smoke" || v === "full") mode = v;
    } else if (arg === "--viewports" && args[i + 1]) {
      viewportNames = args[++i]
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--no-judge") {
      includeJudge = false;
    }
  }

  let viewports = CONFIG.defaultViewports;
  if (viewportNames) {
    const filtered = CONFIG.defaultViewports.filter((vp) =>
      viewportNames!.includes(vp.name.toLowerCase()),
    );
    if (filtered.length) viewports = filtered;
  }

  return { url, routes: uniqueList(routes), mode, viewports, includeJudge };
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const { url, routes, mode, viewports, includeJudge } = parseArgs(
    process.argv,
  );
  const baseUrl = normalizeBaseUrl(url);

  if (!baseUrl) {
    console.error("Error: invalid URL provided.");
    process.exit(1);
  }

  const runId = stableId();
  const runDir = path.join(CONFIG.artifactRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  const routeSpecs = resolveRouteSpecs(routes);

  console.log(`\n--- autobot local test runner ---`);
  console.log(`URL:       ${baseUrl}`);
  console.log(`Run ID:    ${runId}`);
  console.log(`Mode:      ${mode}`);
  console.log(`Routes:    ${routeSpecs.map((r) => r.key).join(", ")}`);
  console.log(`Viewports: ${viewports.map((v) => `${v.name} (${v.width}x${v.height})`).join(", ")}`);
  console.log(`AI Judge:  ${includeJudge ? "enabled" : "disabled"}`);
  console.log(`Artifacts: ${path.resolve(runDir)}`);
  console.log();

  // 1. Screenshots
  console.log("[1/3] Capturing screenshots...");
  let phaseRecords = await runVisualChecks({
    jobId: runId,
    runDir,
    baseUrl,
    routeConfigs: routeSpecs,
    mode,
    viewports,
  });

  const captured = phaseRecords.filter((p) => p.status === "captured").length;
  const failed = phaseRecords.filter((p) => p.status === "failed").length;
  console.log(`      ${captured} captured, ${failed} failed\n`);

  // 2. AI Judge
  if (includeJudge) {
    console.log("[2/3] Running AI judge...");
    phaseRecords = await judgeScreenshots(phaseRecords);
    console.log("      done\n");
  } else {
    console.log("[2/3] AI judge skipped\n");
  }

  // 3. Reports
  console.log("[3/3] Writing reports...");
  const totals = aggregateRunTotals(phaseRecords);
  const status =
    totals.blocking > 0
      ? "failed"
      : totals.capturedPhases === 0
        ? "failed"
        : includeJudge && totals.high >= CONFIG.failOnHighThreshold
          ? "partial"
          : includeJudge && totals.score < CONFIG.minimumScore
            ? "failed"
            : "succeeded";

  const report: RunReport = {
    jobId: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status,
    environment: "custom",
    baseUrl,
    mode,
    routeCount: routeSpecs.length,
    viewportCount: viewports.length,
    includeJudge,
    source: "api",
    phases: phaseRecords,
    totals,
    config: {
      runMode: mode,
      viewports,
      routeSpecs: routeSpecs.map((r) => r.key),
      environment: "local-cli",
      artifactRoot: path.resolve(runDir),
    },
  };

  const jsonPath = await writeJsonReport(runId, report);
  const mdPath = await writeMarkdownReport(runId, report);

  // Summary
  console.log();
  console.log("=== Results ===");
  console.log(`Status:    ${status.toUpperCase()}`);
  if (includeJudge) {
    console.log(`Score:     ${totals.score}`);
    console.log(
      `Findings:  blocking=${totals.blocking} high=${totals.high} medium=${totals.medium} low=${totals.low}`,
    );
  }
  console.log(`Phases:    ${totals.capturedPhases} captured, ${totals.failedPhases} failed`);
  console.log();
  console.log(`Report:    ${path.resolve(mdPath)}`);
  console.log(`JSON:      ${path.resolve(jsonPath)}`);
  console.log(`Artifacts: ${path.resolve(runDir)}`);
  console.log();

  process.exit(status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
