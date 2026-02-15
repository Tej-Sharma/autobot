# Autobot Implementation Fix Notes (autobot / autobot-web)

Scope: `autobot` + `autobot-web` services + Render deployment blueprint.

## What was failing
- Render deploy of the previous blueprint was failing at build stage.
- Root cause identified during validation: Dockerfiles/blueprint context mismatch and TS/queue/OpenAI type issues in autobot and autobot-web.
- `render blueprints validate` initially reported: `docker runtime must not have startCommand`.

## Fixes applied now

### 1) TypeScript/build blockers fixed
Files:
- `autobot/src/state.ts`
  - `setJobStatus()` now accepts `Omit<StatusRecord, 'updatedAt' | 'createdAt' | 'id'>`.
  - This matches all callsites and removes missing `id` typing errors.

- `autobot/src/queue.ts`
  - Switched BullMQ connection from shared `ioredis` instance to URL object:
    - `connection: { url: CONFIG.redisUrl }`
  - Added explicit queue name generic: `Queue<QueuedRun, unknown, 'autobot-run'>`.
  - Explicitly added `'autobot-run' as const` in `qaQueue.add(...)` to satisfy BullMQ name typing.

- `autobot/src/worker.ts`
  - Switched worker connection to URL object:
    - `connection: { url: CONFIG.redisUrl }`.
  - Worker generics aligned with queue name type: `Worker<QueuedRun, unknown, 'autobot-run'>`.

- `autobot/src/github.ts`
  - `parseQaCommandComment()` return type changed from
    `Omit<RunRequest, 'source' | 'sourceMetadata'> | null`
    to `RunRequest | null`.
  - This aligns with `request.sourceMetadata` usage downstream.

- `autobot/src/judge.ts`
  - Removed unsupported `timeout` / `signal` fields from OpenAI request body.
  - Added bounded OpenAI call with `Promise.race` timeout using a local `setTimeout` promise.

- `autobot-web/src/server.ts`
  - Added explicit callback parameter types on implicit-any map/filters:
    - `.map(...: string)` and `.filter(...: string)` callbacks in
      `/api/webhooks/sync` and `/api/runs/default-branch` flows.
    - async callback types in `map` over selected repos.

Result:
- `npm run build` now succeeds in both:
  - `autobot/`
  - `autobot-web/`

### 2) Dockerfile context bugs fixed (the deploy blockers)
Files:
- `autobot/Dockerfile`
- `autobot-web/Dockerfile`

Before:
- Dockerfiles expected copy paths like `autobot/...` and `autobot-web/...` inside service directories.

Now:
- Dockerfiles are self-contained and expect local context (run from their own folder):
  - `COPY package.json ... ./`
  - `COPY src ...`
  - `COPY public ...` (web only)

This resolves the `COPY ... does not exist` class of failures when Render uses each folder as a docker context.

### 3) Render blueprint added/refined
- Added/updated: `render.yaml`
- Uses three services:
  - `autobot` (web)
  - `autobot-worker` (worker)
  - `autobot-web` (front-end)
  - `autobot-redis`
- Uses `dockerContext: autobot` / `autobot-web` with `Dockerfile` path.
- Uses `dockerCommand` (not `startCommand`) for docker services.
- Exposes all external secrets as `sync: false`.

### 4) Render validation result
Command used:
- `render blueprints validate`

Status:
- ✅ passes with current `render.yaml` in this workspace.

## Known remaining operational notes
- This folder (`/Users/tejas1/Documents/Code/_Constella/autobot-codes`) is not a git repo, so this is a working tree snapshot only.
- I could not run local Docker builds in this environment (`Cannot connect to docker daemon`).
- To complete deployment, push these files to the git repo used by Render and click **Apply** on the Render Blueprint.

## Next actions to finish deployment
1. Commit/push this updated tree to the repo Render is connected to.
2. In Render Blueprint, set secrets/env:
   - `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `AUTOBOT_API_TOKEN`, `AUTOBOT_API_BASE_URL` etc.
3. Set `AUTOBOT_WEBHOOK_URL` in `autobot-web` to the public URL of `autobot` webhook endpoint.
4. Configure `AUTOBOT_API_BASE_URL` for manual dashboard run endpoint.
5. Redeploy services from Blueprint and monitor logs for runtime startup.

## Repository strategy (deploy and OAuth/webhook flow)
- Keep `autobot/` and `autobot-web/` in the **same repository** with one shared `render.yaml`.
- Do not split into separate repos unless teams want independent release cadences or permissions boundaries.
- Why:
  - One blueprint deploy/update per code change for both services.
  - Shared OAuth/app bootstrap and environment assumptions stay aligned.
  - Simpler webhook wiring (`autobot-web` -> `autobot`) with fewer secret sync points.

## Docker/Render hardening applied in this workspace
- `autobot/Dockerfile` and `autobot-web/Dockerfile` are self-contained for subfolder context (`dockerContext: autobot` and `autobot-web`).
- `autobot-web/Dockerfile` no longer depends on files outside its folder.
- `render.yaml` uses:
  - `dockerContext` per service
  - `dockerfilePath: Dockerfile`
  - `dockerCommand` instead of `startCommand` for Docker runtime services.
- `autobot` service runs API on `npm run start`; `autobot-worker` runs queue processor on `npm run start:worker`.
