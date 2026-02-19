![CleanShot 2026-02-18 at 19 56 14](https://github.com/user-attachments/assets/acee3976-9ffd-4766-af68-cb73c85e6c05)

Unlike generic AI code reviewers, Autobot actually clicks through your frontend to catch bugs in flow, visual differences, and errors.

## What it does

- **Clicks through your app**: launches a real browser, navigates pages, fills forms, clicks buttons
- **Finds real bugs**: catches broken flows, auth issues, missing content, visual regressions
- **Reports with evidence**: screenshots at every step, structured JSON reports, severity ratings
- **Posts to GitHub**: auto-comments on PRs with test results so teams catch regressions before merge
- **Code fault detection**: static analysis finds security issues, logic bugs, and bad patterns before testing even starts

## Want Zero-Hassle Set Up?

If you want your apps 24/7 tested to ensure 100% product quality for what you are building, sign up on
[AutoBot.It.Com](https://autobot.it.com)

We manage the infastructure & expensive agent costs via our hosted-GPUs all for you. 
Plus premium customer support and tuning the agent for your frontend.

Otherwise, here's the local setup below.

## Roadmap

- [x] Web Frontends
- [x] Testing Your Live Site
- [ ] Mobile (get [early access](mailto:team@constella.app))
- [ ] Backend

## Architecture

```
autobot/           Backend API + worker queue + QA runner + AI test agents
autobot-web/       Next.js dashboard for GitHub onboarding and run management
autobot-agent/     Lightweight agent for per-user Fly Machines (clone, build, screenshot)
render.yaml        Production deployment blueprint for Render
```

### AI Test Agents

Autobot includes multiple AI-powered test agents that analyze your codebase, generate test plans, and execute them:

| Agent | Script | How it works | Cost |
|-------|--------|-------------|------|
| **Claude (agent-driven)** | `app-test.sh` | Claude SDK drives agent-browser in real-time | ~$1.50/run |
| **Script generation** | `app-test-scriptgen.sh` | Claude generates Playwright scripts, executes with zero AI | ~$0.30/run |
| **Gemini** | `app-test-gemini.sh` | Gemini CLI + agent-browser | Free tier |
| **Aider** | `app-test-aider.sh` | Aider + agent-browser | Varies |
| **Cline** | `app-test-cline.sh` | Cline + agent-browser | Varies |
| **OpenHands** | `app-test-openhands.sh` | OpenHands + agent-browser | Varies |
| **Plandex** | `app-test-plandex.sh` | Plandex + agent-browser | Varies |

All agents follow the same pipeline:
1. **Analyze** codebase → find code faults + generate `TESTER.md` test plan
2. **Test** → execute flows (browser interaction or script execution)
3. **Report** → screenshots + markdown report + structured JSON

---

## Quick Start

### Prerequisites

- Node.js 18+
- One of: [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://www.npmjs.com/package/@google/gemini-cli), or another supported agent
- [agent-browser](https://www.npmjs.com/package/agent-browser) (for agent-driven modes)
- Playwright (installed automatically with `npm install`)

### Run the AI tester against any web app

```bash
# Clone and install
git clone https://github.com/Tej-Sharma/autobot.git
cd autobot/autobot
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install

# Go back to root
cd ..

# Test any running web app (agent-driven, uses agent-browser)
./app-test.sh http://localhost:3000 --codebase /path/to/your/app

# Or use the cost-efficient script generation mode (recommended)
./app-test-scriptgen.sh http://localhost:3000 --codebase /path/to/your/app
```

### Script generation mode (recommended)

The `app-test-scriptgen.sh` variant is significantly cheaper and produces deterministic, re-runnable test scripts:

```
Phase 1: Analyze codebase → TESTER.md           (1 LLM call, cached)
Phase 2: Generate Playwright .ts scripts          (1 LLM call)
Phase 3: Execute scripts with Playwright           (0 LLM calls)
Phase 4: Evaluate results + write report           (1 LLM call)
```

**Benefits over agent-driven mode:**
- ~5x cheaper ($0.30 vs $1.50 per run)
- Deterministic — same scripts, same results every time
- Inspectable — read the `.ts` files to see exactly what they test
- Debuggable — re-run any individual script to reproduce a failure
- Cacheable — scripts can be reused across runs

### Options

```bash
./app-test-scriptgen.sh <url> [options]

Options:
  --codebase <path>       Path to the codebase to analyze
  --description <text>    Focus testing on specific flows (e.g., "dashboard")
  --credentials <json>    Login credentials: '{"email":"...","password":"..."}'
  --tester-file <path>    Use existing TESTER.md (skip analysis phase)
  --force-analysis        Regenerate TESTER.md even if cached
  --force-scripts         Regenerate test scripts even if cached
  --max-budget <usd>      Max LLM spend in USD (default: 5)
  --output-dir <path>     Where to write artifacts
```

### Example with credentials

```bash
./app-test-scriptgen.sh http://localhost:3000 \
  --codebase ../my-app \
  --credentials '{"email":"test@example.com","password":"testpass123"}' \
  --max-budget 3
```

### Using Gemini (free)

```bash
# Install Gemini CLI
npm install -g @google/gemini-cli

# Run (uses Gemini 3 Flash, free tier)
./app-test-gemini.sh http://localhost:3000 --codebase /path/to/your/app
```

---

## Output

All agents produce the same output structure in `autobot/artifacts/<run-id>/`:

```
artifacts/<run-id>/
  screenshots/           PNG screenshots at each test step
  scripts/               Generated Playwright scripts (scriptgen mode only)
  agent-test-report.md   Human-readable test report
  agent-test-report.json Structured results for CI integration
```

### JSON report schema

```json
{
  "status": "passed | partial | failed",
  "flowsTotal": 16,
  "flowsPassed": 9,
  "flowsFailed": 2,
  "flowsSkipped": 5,
  "codeFaults": 15,
  "findings": [
    {
      "severity": "blocking | high | medium | low",
      "category": "Security - Authentication",
      "message": "API token auth is optional",
      "url": "http://localhost:4173/api/qa/run",
      "screenshot": "06-001-qa-run-queued.png"
    }
  ],
  "routesTested": ["/", "/dashboard", "/api/health"],
  "summary": "..."
}
```

---

## Full Platform Setup

The full platform includes a backend API, worker queue, and web dashboard for GitHub-integrated QA automation.

### 1) Backend (`autobot/`)

```bash
cd autobot
cp .env.example .env
npm install
```

Edit `.env` with your values:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | For AI tester | Claude API key |
| `OPENAI_API_KEY` | For QA judge | OpenAI key for scoring |
| `GITHUB_WEBHOOK_SECRET` | For webhooks | GitHub webhook verification |
| `GITHUB_OAUTH_CLIENT_ID` | For login | GitHub OAuth app client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | For login | GitHub OAuth app secret |
| `AUTOBOT_API_TOKEN` | Recommended | API auth token for requests |
| `REDIS_URL` | For queue | Redis connection string |

Start backend:

```bash
npm run dev:server   # API on :4000
npm run dev:worker   # QA worker
```

### 2) Web dashboard (`autobot-web/`)

```bash
cd autobot-web
cp .env.example .env
npm install
npm run dev          # Dashboard on :4173
```

Edit `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTOBOT_API_BASE_URL` | Yes | Backend URL (e.g., `http://localhost:4000`) |
| `GITHUB_OAUTH_CLIENT_ID` | For login | Must match backend |
| `GITHUB_OAUTH_CLIENT_SECRET` | For login | Must match backend |

### 3) GitHub OAuth setup

Create a [GitHub OAuth App](https://github.com/settings/developers):
- **Authorization callback URL**: `http://localhost:4173/api/auth/github/callback`
- Copy the Client ID and Secret into both `.env` files

### 4) Webhook wiring

In your GitHub repo settings → Webhooks:
- **Payload URL**: `https://<your-backend>/api/github/webhook`
- **Content type**: `application/json`
- **Secret**: must match `GITHUB_WEBHOOK_SECRET` in `.env`
- **Events**: Pull requests, Issue comments

### 5) Docker (optional)

```bash
cd autobot
docker compose up --build
```

---

## API

Queue a QA run:

```bash
curl -X POST http://localhost:4000/api/qa/run \
  -H "content-type: application/json" \
  -H "x-api-key: $AUTOBOT_API_TOKEN" \
  -d '{
    "environment": "production",
    "baseUrl": "https://your-site.com",
    "routes": ["home", "pricing"],
    "mode": "smoke",
    "includeJudge": true
  }'
```

Check job status:

```bash
curl http://localhost:4000/api/qa/jobs/<jobId>
```

---

## Production Deployment

Use the included `render.yaml` for Render deployment. Set secrets in the Render dashboard — all sensitive values use `sync: false` and are never stored in the file.

---

## Contributing

PRs welcome for:

- New AI agent backends
- Better route detection and page readiness heuristics
- QA judge prompt improvements
- Dashboard UX
- CI/CD integration examples

## License

This project is licensed under a custom non-commercial license for open contributions and self-serve use only:

- Non-commercial use, testing, and contributions are allowed.
- Commercial use, redistribution as paid service, and monetization are not allowed without a separate commercial agreement.

See [`LICENSE`](LICENSE) for full terms.
