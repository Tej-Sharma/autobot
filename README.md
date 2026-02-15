# Autobot

Autobot is an open-source PR quality automation stack that runs visual QA and optional AI judgment on your web app, then posts results back to GitHub.

## Why this project exists

Open-source projects often depend on manual visual checks and reviewer bandwidth. Autobot removes that bottleneck by running reproducible checks from code events (webhooks), collecting screenshots/artifacts, and summarizing findings in a way teams can act on quickly.

## Value, fast and practical

- **Time saved**: speeds up review cycles by cutting repetitive smoke/visual checks out of the human loop.
- **Peace of mind**: standardizes QA signals with a consistent job flow (queue + worker + artifacts).
- **Instant alerting**: posts run outcomes automatically to GitHub PR flow so teams notice regressions fast.
- **Faster first-pass validation**: route-by-route screenshot evidence and optional AI judgment reduce guesswork during triage.
- **Auditability**: job artifacts and JSON/Markdown reports keep context for follow-up and debugging.

## What Autobot gives you

- Playwright-based browser checks (`initial-load`, CTA coverage, interactions, scroll points)
- Optional AI judge scoring and findings
- API and webhook-backed job intake
- Queue-driven workers with Redis
- Self-hosted frontend console for GitHub OAuth and repo/webhook setup

## Prefer Done for You

Need a zero-hassle path? We handle the infrastructure, tokens, running cost, and setup on your private machine: [autobot.it.com](https://autobot.it.com).

## Architecture at a glance

- `autobot/`: backend API + worker queue + QA runner
- `autobot-web/`: user dashboard / GitHub onboarding console
- `render.yaml`: optional production blueprint for Render

## Setup (development)

### 1) Prerequisites

- Node.js 18+
- Redis (local or Docker)
- GitHub OAuth App (for dashboard users)
- OpenAI API key (for AI judge)

### 2) Backend setup (`autobot`)

```bash
git clone https://github.com/your-org/autobot-codes.git
autobot/autobot
cd autobot-codes/autobot
cp .env.example .env
npm install
```

Edit `autobot/.env` with your values:

- `OPENAI_API_KEY` (required for AI judge)
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `GITHUB_WEBHOOK_SECRET` (GitHub webhook verification)
- `GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_ALLOWED_REPOS` (comma-separated allowlist)
- `AUTOBOT_WEBHOOK_URL` (backend webhook entrypoint)
- `AUTOBOT_API_TOKEN` (API hardening token for request auth)
- `VERCEL_TOKEN` + `VERCEL_PROJECT_ID` (if preview URL lookup is enabled)
- Optional: `GITHUB_TOKEN` (fallback PAT only)

Start backend services:

```bash
npm run dev:server   # API
npm run dev:worker   # Runner worker
```

### 3) Web console setup (`autobot-web`)

```bash
cd ../autobot-web
cp .env.example .env
npm install
npm run dev
```

Edit `autobot-web/.env`:

- `AUTOBOT_API_BASE_URL` (for example: `https://<your-backend-host>`)

Open http://localhost:4173 and connect your GitHub account to begin onboarding repos/webhooks.

### 4) Webhook + callback wiring

Configure your GitHub OAuth app and backend endpoints:

- OAuth callback URL (backend): `https://<your-domain>/api/auth/github/callback`
- API webhook URL (in GitHub App/repo settings): `https://<your-backend-host>/api/github/webhook`
- Ensure app can reach public callback and webhook endpoints.

### 5) Optional Docker path

```bash
cd autobot-codes/autobot
docker compose up --build
```

Backend is typically available at `http://localhost:4000` and web at `http://localhost:4173` in local mode.

## Environment strategy (important)

- Keep `.env` local-only and out of git.
- Inject secrets in production using your host platform’s secret storage (Render, etc.).
- Never commit generated artifacts or machine-specific API tokens.

## API quick start

Run a QA job:

```bash
curl -X POST http://localhost:4000/api/qa/run \
  -H "content-type: application/json" \
  -H "x-api-key: $AUTOBOT_API_TOKEN" \
  -d '{
    "environment":"production",
    "baseUrl":"https://your-site.com",
    "routes":["home","pricing"],
    "mode":"smoke",
    "includeJudge":true
  }'
```

Check job status:

```bash
curl http://localhost:4000/api/qa/jobs/<jobId>
```

Report artifacts are written under `/artifacts/<jobId>/`.

## Production deployment pointers

If you deploy with Render, use the included `render.yaml` and set secrets in the dashboard:

- API token, webhooks, GitHub OAuth credentials, OpenAI key, Vercel tokens, Redis connection
- `AUTOBOT_API_BASE_URL` in `autobot-web` must point at backend endpoint

## Contributing

This is an open-source project. PRs are welcome for:

- Better route heuristics and page readiness checks
- New judge prompts / scoring strategies
- CI and deployment reliability improvements
- Dashboard UX for repo onboarding and run visibility

## License

This project is licensed under a custom non-commercial license for open contributions and self-serve use only:

- Non-commercial use, testing, and contributions are allowed.
- Commercial use, redistribution as paid service, and monetization are not allowed without a separate commercial agreement.

See [`LICENSE`](LICENSE) for full terms.
