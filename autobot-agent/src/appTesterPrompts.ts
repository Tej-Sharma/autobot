/**
 * Prompt engineering for the AI App Tester.
 *
 * Phase 1: Codebase analysis — finds code faults + writes structured TESTER.md
 * Phase 2: Test execution — runs flows as isolated pages, sequential chains, or rooted groups
 */

/* ------------------------------------------------------------------ */
/*  Phase 1: Codebase Analysis + Code Fault Detection                  */
/* ------------------------------------------------------------------ */

export const ANALYSIS_SYSTEM_PROMPT = `You are an expert QA engineer and code reviewer analyzing a web application codebase.

You have TWO jobs:
1. Find code-level faults (bugs, security issues, bad patterns) by reading the source
2. Produce a comprehensive TESTER.md that maps out every testable user flow

For code faults, look for:
- Security issues (exposed secrets, XSS, SQL injection, missing auth checks)
- Logic bugs (wrong conditionals, off-by-one, unhandled edge cases)
- Missing error handling (uncaught promises, missing try/catch, no 404 pages)
- Dead code or broken imports
- Hardcoded values that should be configurable
- Race conditions or state management issues
- Accessibility problems (missing alt tags, no ARIA labels)

Report these in a CODE_FAULTS section of the TESTER.md so the testing agent knows what to watch for.`;

export function buildAnalysisPrompt(testerMdPath: string): string {
  return `Analyze the codebase in the current working directory.

Read through the entire project. Look at:
1. **Framework and tech stack** — package.json, config files, build setup
2. **All routes/pages** — every URL the app serves, what each page does
3. **Authentication system** — signup, login, logout, OAuth, session handling
4. **Forms and fields** — field names, types, validation rules
5. **Key interactive elements** — buttons, modals, dropdowns, CRUD operations
6. **API endpoints** — REST/GraphQL routes, request/response shapes
7. **Database models / data structures** — entities, relationships
8. **Error handling** — error pages, validation messages, API errors
9. **Navigation structure** — sidebar, navbar, breadcrumbs, links
10. **Code quality issues** — bugs, security holes, bad patterns

Write a TESTER.md file to: ${testerMdPath}

## CRITICAL: Use this EXACT format

\`\`\`markdown
# App Test Plan: <app-name>

## Tech Stack
- Framework: ...
- Auth: ...
- Database: ...
- UI Library: ...

## Code Faults Found
Issues discovered during static analysis. The testing agent should verify these.

| # | Severity | File | Issue | Impact |
|---|----------|------|-------|--------|
| 1 | high | src/auth.ts:45 | OAuth callback URL hardcoded to production | Local dev login broken |
| 2 | medium | src/api/users.ts:12 | No input validation on email field | Potential injection |
| 3 | low | components/Nav.tsx | Placeholder links point to /# | Dead navigation |

## Routes
| Path | Purpose | Auth Required | Sections/Content |
|------|---------|---------------|------------------|
| / | Landing page | no | Hero, Pipeline Demo, Integrations, How It Works, Footer |
| /dashboard | Main dashboard | yes | Repo list, Webhook sync, Run now, Logout |
| /pricing | Pricing page | no | Plans table, FAQ, CTA |

## Test Flows

<!-- FLOW_START -->
\`\`\`json
{
  "id": "page-landing",
  "name": "Landing Page Full Check",
  "kind": "page",
  "auth": false,
  "priority": "critical",
  "route": "/",
  "sections": ["Hero", "Pipeline Demo", "Integrations", "How It Works", "Footer"],
  "buttons": ["Connect GitHub now", "View Demo", "Open Source on GitHub"],
  "startFrom": null,
  "chain": null
}
\`\`\`
### Landing Page Full Check
**Scroll through all sections:** Hero → Pipeline Demo → Integrations → How It Works → Footer
**Click each main button:** "Connect GitHub now", "View Demo", "Open Source on GitHub"
**After each button click:** verify what happens, then navigate back to /
**Verify:** All sections render, no broken images, no layout issues, all buttons respond
<!-- FLOW_END -->

<!-- FLOW_START -->
\`\`\`json
{
  "id": "nav-auth-guard",
  "name": "Dashboard Auth Guard",
  "kind": "navigation",
  "auth": false,
  "priority": "critical",
  "route": "/dashboard",
  "startFrom": null,
  "chain": null
}
\`\`\`
### Dashboard Auth Guard
**Steps:**
1. Navigate to /dashboard without auth
2. Expected: redirect to / or /login
**Verify:** URL changes away from /dashboard
<!-- FLOW_END -->

<!-- FLOW_START -->
\`\`\`json
{
  "id": "seq-login",
  "name": "User Login Flow",
  "kind": "sequential",
  "auth": true,
  "priority": "critical",
  "route": "/login",
  "startFrom": null,
  "chain": null
}
\`\`\`
### User Login Flow
**Steps:**
1. Navigate to /login
2. Fill email with test credentials
3. Fill password
4. Click submit
5. Expected: redirect to /dashboard
**Error cases:**
- Empty submission → validation errors
- Wrong password → error message
**Verify:** URL is /dashboard, user info visible
<!-- FLOW_END -->

<!-- FLOW_START -->
\`\`\`json
{
  "id": "rooted-dashboard-repos",
  "name": "Dashboard: Repository List",
  "kind": "rooted",
  "auth": true,
  "priority": "high",
  "route": "/dashboard",
  "startFrom": "/dashboard",
  "chain": ["seq-login"]
}
\`\`\`
### Dashboard: Repository List
**Prerequisite:** Must be logged in (run seq-login first)
**Starting from:** /dashboard
**Steps:**
1. Verify repo list is visible
2. Click checkboxes on repos
3. Verify selection state
**Verify:** Repos render, checkboxes work
<!-- FLOW_END -->

<!-- FLOW_START -->
\`\`\`json
{
  "id": "rooted-dashboard-webhook",
  "name": "Dashboard: Webhook Sync",
  "kind": "rooted",
  "auth": true,
  "priority": "high",
  "route": "/dashboard",
  "startFrom": "/dashboard",
  "chain": ["seq-login"]
}
\`\`\`
### Dashboard: Webhook Sync
**Prerequisite:** Must be logged in (run seq-login first)
**Starting from:** /dashboard
**Steps:**
1. Select a repo
2. Click "Enable webhook" button
3. Expected: success/failure message
**Verify:** Sync message appears
<!-- FLOW_END -->

<!-- FLOW_START -->
\`\`\`json
{
  "id": "api-health",
  "name": "Health Check API",
  "kind": "api",
  "auth": false,
  "priority": "high",
  "route": "/health",
  "startFrom": null,
  "chain": null
}
\`\`\`
### Health Check API
**Command:** curl http://<baseUrl>/health
**Expected:** {"ok":true} with status 200
<!-- FLOW_END -->
\`\`\`

## Flow kinds:
- **page** — Navigate to a route, scroll through ALL sections listed, click each main button, backtrack after each click. Most thorough.
- **navigation** — Test redirects, links, URL changes. Quick.
- **sequential** — Multi-step chain: A → B → C. Steps depend on each other.
- **rooted** — Multiple tests sharing a starting point. Has \`startFrom\` (the root page) and \`chain\` (prerequisite flow IDs to run first).
- **api** — Test API endpoints via curl. No browser needed.

## Flow metadata fields:
- \`id\` — unique identifier
- \`name\` — human-readable name
- \`kind\` — page | navigation | sequential | api | rooted
- \`auth\` — true if login required
- \`priority\` — critical | high | medium | low
- \`route\` — the URL path
- \`sections\` — (page kind only) array of section names to scroll through
- \`buttons\` — (page kind only) array of button labels to click
- \`startFrom\` — (rooted kind) which route to start at
- \`chain\` — (rooted kind) array of flow IDs that must run first

## Rules:
- Every route MUST have at least one flow
- Page flows MUST list all visible sections and main buttons
- Rooted flows MUST specify their startFrom and chain dependencies
- Code faults table MUST include file paths and line numbers where possible
- Priority order: critical > high > medium > low
- Be thorough — don't skip routes or interactive elements
\`\`\`

Write the complete file to: ${testerMdPath}`;
}

/* ------------------------------------------------------------------ */
/*  Flow parsing                                                       */
/* ------------------------------------------------------------------ */

export interface ParsedFlow {
  id: string;
  name: string;
  kind: "page" | "navigation" | "sequential" | "rooted" | "api";
  auth: boolean;
  priority: "critical" | "high" | "medium" | "low";
  route: string;
  sections?: string[]; // page kind: sections to scroll through
  buttons?: string[]; // page kind: buttons to click + backtrack
  startFrom?: string; // rooted kind: root page
  chain?: string[]; // rooted kind: prerequisite flow IDs
  content: string; // full markdown of this flow
}

export function parseFlows(testerMd: string): ParsedFlow[] {
  const flows: ParsedFlow[] = [];
  const flowRegex =
    /<!-- FLOW_START -->\s*```json\s*(\{[\s\S]*?\})\s*```([\s\S]*?)<!-- FLOW_END -->/g;

  let match;
  while ((match = flowRegex.exec(testerMd)) !== null) {
    try {
      const meta = JSON.parse(match[1]) as Record<string, unknown>;
      const content = match[2].trim();

      flows.push({
        id: String(meta.id ?? `flow-${flows.length + 1}`),
        name: String(meta.name ?? "Unnamed Flow"),
        kind: (meta.kind as ParsedFlow["kind"]) ?? "page",
        auth: Boolean(meta.auth),
        priority: (meta.priority as ParsedFlow["priority"]) ?? "medium",
        route: String(meta.route ?? "/"),
        sections: Array.isArray(meta.sections)
          ? meta.sections.map(String)
          : undefined,
        buttons: Array.isArray(meta.buttons)
          ? meta.buttons.map(String)
          : undefined,
        startFrom: meta.startFrom ? String(meta.startFrom) : undefined,
        chain: Array.isArray(meta.chain) ? meta.chain.map(String) : undefined,
        content,
      });
    } catch {
      // Skip unparseable flows
    }
  }

  return flows;
}

/**
 * Extract code faults from the TESTER.md (the table in ## Code Faults Found).
 */
export function parseCodeFaults(testerMd: string): string {
  const faultsMatch = testerMd.match(/## Code Faults Found[\s\S]*?(?=\n## )/);
  return faultsMatch ? faultsMatch[0].trim() : "";
}

/* ------------------------------------------------------------------ */
/*  Flow filtering                                                     */
/* ------------------------------------------------------------------ */

export function filterFlows(
  flows: ParsedFlow[],
  hasCredentials: boolean,
  description?: string,
): ParsedFlow[] {
  let filtered = flows;

  if (!hasCredentials) {
    filtered = filtered.filter((f) => !f.auth);
  }

  if (description) {
    const lower = description.toLowerCase();
    const matching = filtered.filter(
      (f) =>
        f.name.toLowerCase().includes(lower) ||
        f.route.toLowerCase().includes(lower) ||
        f.content.toLowerCase().includes(lower),
    );
    const nonMatching = filtered.filter(
      (f) =>
        !f.name.toLowerCase().includes(lower) &&
        !f.route.toLowerCase().includes(lower) &&
        !f.content.toLowerCase().includes(lower),
    );
    filtered = [...matching, ...nonMatching];
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  filtered.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return filtered;
}

/* ------------------------------------------------------------------ */
/*  Flow grouping: isolated, sequential chains, rooted groups          */
/* ------------------------------------------------------------------ */

export interface FlowGroup {
  groupName: string;
  groupType: "isolated" | "chain" | "rooted-group" | "api-batch";
  flows: ParsedFlow[];
}

/**
 * Group flows into execution groups:
 * - Each "page" flow → its own isolated group (full scroll + button clicks)
 * - Each "navigation" flow → its own isolated group
 * - "sequential" flows → their own isolated group (they're already a chain)
 * - "rooted" flows → grouped by startFrom (all dashboard flows together)
 * - "api" flows → batched together (cheap curl calls)
 */
export function groupFlows(flows: ParsedFlow[]): FlowGroup[] {
  const groups: FlowGroup[] = [];

  // 1. Each page flow runs alone (full scroll-through + button clicks is complex)
  for (const f of flows.filter((f) => f.kind === "page")) {
    groups.push({
      groupName: `Page: ${f.name}`,
      groupType: "isolated",
      flows: [f],
    });
  }

  // 2. Each navigation flow runs alone (quick but needs its own context)
  for (const f of flows.filter((f) => f.kind === "navigation")) {
    groups.push({
      groupName: `Nav: ${f.name}`,
      groupType: "isolated",
      flows: [f],
    });
  }

  // 3. Each sequential flow runs alone (it's its own multi-step chain)
  for (const f of flows.filter((f) => f.kind === "sequential")) {
    groups.push({
      groupName: `Chain: ${f.name}`,
      groupType: "chain",
      flows: [f],
    });
  }

  // 4. Rooted flows: group by startFrom
  const rooted = flows.filter((f) => f.kind === "rooted");
  const byRoot = new Map<string, ParsedFlow[]>();
  for (const f of rooted) {
    const root = f.startFrom ?? f.route;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root)!.push(f);
  }
  for (const [root, rootFlows] of byRoot) {
    // Find the chain prerequisite (e.g., login flow) and prepend it
    const chainIds = new Set(rootFlows.flatMap((f) => f.chain ?? []));
    const prereqs = flows.filter((f) => chainIds.has(f.id));
    const allFlows = [...prereqs, ...rootFlows];
    groups.push({
      groupName: `Rooted: ${root} (${rootFlows.length} flows)`,
      groupType: "rooted-group",
      flows: allFlows,
    });
  }

  // 5. API flows batched together (cheap)
  const apiFlows = flows.filter((f) => f.kind === "api");
  if (apiFlows.length) {
    groups.push({
      groupName: `API Tests (${apiFlows.length})`,
      groupType: "api-batch",
      flows: apiFlows,
    });
  }

  return groups;
}

/* ------------------------------------------------------------------ */
/*  Phase 2: Per-group test prompts                                    */
/* ------------------------------------------------------------------ */

export const TESTING_SYSTEM_PROMPT = `You are an expert QA tester. You test a web application using agent-browser CLI commands via Bash.

## agent-browser Workflow
1. \`agent-browser open <url>\` — Navigate to a page
2. \`agent-browser snapshot -i\` — Get interactive elements with refs (@e1, @e2)
3. \`agent-browser click @eN\` / \`agent-browser fill @eN "value"\` — Interact using refs
4. **Re-snapshot after every page change** — refs get invalidated
5. \`agent-browser screenshot <path>\` — Save visual evidence
6. \`agent-browser get text @eN\` — Verify content
7. \`agent-browser get url\` — Verify navigation
8. \`agent-browser wait --load networkidle\` — Wait after navigation

## Commands
Navigation: open, back, forward, reload
Input: fill, type, press, select, check, uncheck
Actions: click, dblclick, hover, scroll
Info: snapshot -i, get text, get url, get title, get value
Wait: wait <selector>, wait <ms>, wait --load networkidle, wait --text "..."
Capture: screenshot <path>, screenshot <path> --full
State: state save <name>, state load <name>
Find: find text "..." click, find role button click --name "Submit"

## Testing Strategy
- **Exhaust current state before advancing**: Before any action that changes page state (login, navigate, submit), test ALL edge cases on the current page first. Example: on an auth page, try empty submit, invalid email, wrong password BEFORE logging in successfully.
- **Backtrack to cover all features**: After testing a flow, navigate back and explore other paths you haven't tested.
- **Error threshold**: If you discover 3 distinct bugs or errors, STOP testing immediately and write the report. 3 errors is enough to flag the build.

## Rules
- ALWAYS snapshot before interacting
- Re-snapshot after page changes
- Be concise — don't explore beyond the assigned flows
- Report PASS/FAIL/SKIP for each flow`;

export function buildGroupTestPrompt(input: {
  baseUrl: string;
  group: FlowGroup;
  codeFaults: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  mockEmail: string;
  groupIndex: number;
  totalGroups: number;
}): string {
  const {
    baseUrl,
    group,
    codeFaults,
    credentials,
    screenshotDir,
    mockEmail,
    groupIndex,
    totalGroups,
  } = input;

  const prefix = String(groupIndex + 1).padStart(2, "0");
  const credSection = credentials
    ? `Credentials: ${JSON.stringify(credentials)}`
    : `Mock: email=${mockEmail}, password=TestPass123!`;

  let flowInstructions = "";

  for (const flow of group.flows) {
    flowInstructions += `\n### ${flow.name} (${flow.kind}, ${flow.priority})\n`;
    flowInstructions += `Route: ${flow.route}\n`;

    if (flow.kind === "page") {
      flowInstructions += `\n**Full page test procedure:**\n`;
      flowInstructions += `1. Navigate to ${baseUrl}${flow.route}\n`;
      flowInstructions += `2. Screenshot the initial viewport\n`;

      if (flow.sections?.length) {
        flowInstructions += `3. Scroll through each section and screenshot:\n`;
        for (const section of flow.sections) {
          flowInstructions += `   - Scroll to "${section}" section → screenshot\n`;
        }
      } else {
        flowInstructions += `3. Scroll down in 25% increments, screenshot each position\n`;
      }

      if (flow.buttons?.length) {
        flowInstructions += `4. Click each main button, verify what happens, then go BACK to ${flow.route}:\n`;
        for (const btn of flow.buttons) {
          flowInstructions += `   - Find and click "${btn}" → screenshot result → navigate back to ${baseUrl}${flow.route}\n`;
        }
      }

      flowInstructions += `5. Verify: all sections rendered, no broken images, no layout issues\n`;
    } else {
      flowInstructions += flow.content + "\n";
    }
  }

  // Include relevant code faults for this group
  let faultSection = "";
  if (codeFaults) {
    const relevantRoutes = group.flows.map((f) => f.route);
    faultSection = `\n## Known Code Faults (verify during testing)\n${codeFaults}\nPay attention to any faults related to routes: ${relevantRoutes.join(", ")}\n`;
  }

  return `Group ${groupIndex + 1}/${totalGroups}: ${group.groupName}
App URL: ${baseUrl}
${credSection}
${faultSection}

## Flows to test:
${flowInstructions}

## Instructions
- Screenshot prefix: ${prefix}-XXX (e.g., ${prefix}-001-initial.png, ${prefix}-002-scrolled.png)
- Save screenshots to: ${screenshotDir}/
- For page flows: scroll ALL sections, click ALL listed buttons, backtrack after each
- For each flow, output: PASS: <name> or FAIL: <name>: <reason> or SKIP: <name>: <reason>
- If a button click navigates away, use \`agent-browser back\` or \`agent-browser open ${baseUrl}<route>\` to return
- Be efficient — complete the assigned flows and stop`;
}

/**
 * Build the final report aggregation prompt.
 */
export function buildReportPrompt(input: {
  artifactDir: string;
  groupResults: Array<{ groupName: string; output: string }>;
  codeFaults: string;
  baseUrl: string;
  totalFlows: number;
  skippedFlows: number;
}): string {
  const {
    artifactDir,
    groupResults,
    codeFaults,
    baseUrl,
    totalFlows,
    skippedFlows,
  } = input;

  const groupSummaries = groupResults
    .map((g) => `### ${g.groupName}\n${g.output}`)
    .join("\n\n");

  return `Write test reports based on these results.

App URL: ${baseUrl}
Total flows: ${totalFlows}
Skipped (no auth): ${skippedFlows}

## Code Faults (from static analysis):
${codeFaults || "None found."}

## Test Group Results:

${groupSummaries}

## Write two files:

1. **${artifactDir}/agent-test-report.md** with:
   - Code faults summary (from static analysis)
   - Test results table (each flow: pass/fail/skip)
   - Issues found during testing (severity, description, URL, screenshot)
   - Routes tested
   - Overall assessment

2. **${artifactDir}/agent-test-report.json**:
\`\`\`json
{
  "status": "passed" | "partial" | "failed",
  "flowsTotal": ${totalFlows},
  "flowsPassed": <count>,
  "flowsFailed": <count>,
  "flowsSkipped": ${skippedFlows},
  "codeFaults": <count from static analysis>,
  "findings": [{"severity": "...", "category": "...", "message": "...", "url": "...", "screenshot": "..."}],
  "routesTested": ["..."],
  "summary": "one paragraph"
}
\`\`\``;
}

/* ------------------------------------------------------------------ */
/*  Legacy single-prompt (for non-Claude variants)                     */
/* ------------------------------------------------------------------ */

export function buildTestPrompt(input: {
  baseUrl: string;
  testerMd: string;
  description?: string;
  credentials?: Record<string, string>;
  screenshotDir: string;
  artifactDir: string;
  mockEmail: string;
}): string {
  const {
    baseUrl,
    testerMd,
    description,
    credentials,
    screenshotDir,
    artifactDir,
    mockEmail,
  } = input;

  const credentialSection = credentials
    ? `Use these credentials:\n${Object.entries(credentials)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")}`
    : `No credentials. Create account with:\n  Email: ${mockEmail}\n  Password: TestPass123!\n  Name: Test User`;

  const focusSection = description
    ? `**Focus on:** ${description}`
    : "Test all major flows systematically.";

  return `Test the web application at: ${baseUrl}

${focusSection}

## Credentials
${credentialSection}

## Test Plan
---
${testerMd}
---

## Instructions
For each test flow:
1. Screenshot at start
2. Execute steps using agent-browser
3. For page flows: scroll ALL sections, click ALL main buttons, backtrack after each
4. Verify outcomes with get text / get url
5. Screenshot important states
6. Note issues

Save screenshots to: ${screenshotDir}/

After all tests, write:
- ${artifactDir}/agent-test-report.md (summary table + findings)
- ${artifactDir}/agent-test-report.json (structured JSON)

Run \`agent-browser close\` when done.`;
}
