# Autobot — The Non-Boring Onboarding Scroll

Think of this like a launch card:
1) drop inputs
2) click run
3) get pages with screenshots + AI judgment
4) let humans decide what “polish” means this week.

---

## Mission
- Collect visual signals from real browsers (Playwright)
- Keep humans in the loop with scored findings
- Post results to API/PR + artifacts
- Make “production-ish” behavior usable locally and in CI

---

## Open-source + self-hosted setup

This service is self-hosting ready and OSS-friendly:
- No secrets are hard-coded in tracked source files.
- Secrets are loaded from local env files and process environment at runtime.
- Use local secret files only for development, and platform secret stores for production.
- Keep all env files out of version control.

Quick setup:
1. Copy `autobot/.env.example` to `autobot/.env`.
2. Fill your values and start locally with `npm run dev:server` / `npm run dev:worker`, or `docker compose up --build`.
3. In production, inject env vars from your deployment secret store (Render/Railsway/Fly/etc.) instead of shipping `.env`.

Environment key locations:
- `autobot/.env` (`autobot/src/config.ts`)
- `autobot-web/.env` (`autobot-web/src/server.ts`)

Source of truth for secret names in `autobot/.env`:
- `OPENAI_API_KEY` → visual judge
- `GITHUB_TOKEN` → optional fallback GitHub credential for comment posting + PR metadata enrichment
  (the product's self-serve path uses OAuth repository tokens and does not require a PAT)
- `POST /api/integrations/repo-tokens` receives user OAuth tokens for self-serve PR posting
- `GITHUB_WEBHOOK_SECRET` → optional webhook signature verification
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `AUTOBOT_WEBHOOK_URL` → backend webhook endpoint target
- `VERCEL_TOKEN` → optional preview URL resolution
- `AUTOBOT_API_TOKEN` → optional API access key (`x-api-key`)

Source of secret names in `autobot-web/.env`:
- `AUTOBOT_API_BASE_URL` (backend API URL for `/api` proxy requests)

Everything else is operational config (not secrets), but keep it in `.env` too.

---

## Setup ritual (atypical, but explicit)

```bash
cd /Users/tejas1/Documents/Code/_Constella/autobot-codes/autobot
cp .env.example .env
```

Open `.env` and fill values for the keys above.

Then:

```bash
npm install
npm run dev:server   # Terminal A
npm run dev:worker   # Terminal B
```

If you want Docker:

```bash
docker compose up --build
```

API endpoint comes up on `http://localhost:4000`.

---

## Run commandbook

### API call

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

### Pull status + artifacts

```bash
curl http://localhost:4000/api/qa/jobs/<jobId>
```

Look under:
- `/artifacts/<jobId>/qa-report.json`
- `/artifacts/<jobId>/qa-report.md`
- `/artifacts/<jobId>/<route>/<viewport>/<phase>.png`

---

## Flow map (what really happens)

- `POST /api/qa/run` or webhook arrives
- payload normalized + validated
- job enqueued in BullMQ (`received` → `queued`)
- worker pulls job and launches Chromium
- screenshots recorded at phase boundaries:
  - `initial-load`
  - `primary-cta` / `primary-cta-missing`
  - `after-interaction` (full mode)
  - `scroll-mid`
  - `scroll-bottom`
- optional AI judge writes findings + score
- report gets written (JSON + Markdown)
- status endpoint and PR comment update with outcome

---

## Important keys and where they are consumed

- `src/config.ts`
  - canonical parser for env/ints/booleans/defaults
- `src/github.ts`
- `GITHUB_TOKEN` (optional fallback), `GITHUB_WEBHOOK_SECRET`, `GITHUB_ALLOWED_REPOS`
- `src/vercel.ts`
  - `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`
- `src/judge.ts`
  - `OPENAI_API_KEY`, `OPENAI_MODEL`, timeout/retry knobs
- `src/server.ts`
  - `AUTOBOT_API_TOKEN`

---

## Production deployment shape

- `api` container: request intake + status/artifacts
- `worker` container: browser execution
- `redis` container: queue + run status
- shared `/app/artifacts` volume between `api` and `worker`

Everything is in:
- `/Users/tejas1/Documents/Code/_Constella/autobot-codes/autobot/docker-compose.yml`
- `/Users/tejas1/Documents/Code/_Constella/autobot-codes/autobot/Dockerfile`

### Render production mode (recommended for this stack)

Render can run this in a durable way with `render.yaml` (two-service model):

- `autobot` (web)
  - `runtime: docker`
  - `dockerContext: autobot`
  - starts with `node dist/server.js`
- `autobot-worker` (worker)
  - `runtime: docker`
  - `dockerContext: autobot`
  - starts with `node dist/worker.js`
- `autobot-redis` (`type: redis`)
- `autobot-web` (landing + OAuth dashboard)

Keep these in mind:

- `REDIS_URL` should come from `autobot-redis`.
- `AUTOBOT_API_TOKEN` can be used for API hardening but is optional.
- `GITHUB_TOKEN` is optional fallback only; OAuth tokens are the default for self-serve posting.
- Keep secrets in Render dashboard (not in repo files).

---

## Too complex / many tokens? Use our self hosted version here (link; [autobot.it.com](https://autobot.it.com)) to broker our Vercel tokens instead

If you don’t want to wire OpenAI/Vercel/GitHub app credentials now, use:
- hosted execution path on [autobot.it.com](https://autobot.it.com)
- team/project-scoped token handling
- fewer local secret dependencies for first-pass validation

You can still run local dry-runs first, then migrate to hosted once behavior is approved.

---

## Notes

- Keep `.env` out of git.
- `GITHUB_ALLOWED_REPOS` can stay empty for no allowlist.
- If artifact retention is noisy, tune retention and mount a bigger/shared filesystem.
