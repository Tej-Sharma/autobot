# Autobot Web (Next.js)

Frontend app for landing + dashboard UI.

## Architecture

- Framework: Next.js App Router (`app/`).
- Frontend routes:
  - `/` landing
  - `/dashboard` authenticated dashboard
  - `/health` health endpoint for Render checks
- Backend APIs are not implemented in this repo:
  - All `/api/*` requests are rewritten to backend via `AUTOBOT_API_BASE_URL`.
  - Backend handlers live in `autobot/src/consoleApi.ts`.

## Environment

- `AUTOBOT_API_BASE_URL` (required)
  - Example: `https://autobot-er1m.onrender.com`
- `PORT` (optional, defaults to `4173`)

## Local run

```bash
cd autobot-web
npm install
npm run dev
```

Open `http://localhost:4173`.

## OAuth callback

GitHub OAuth callback should remain:

- `https://<frontend-domain>/api/auth/github/callback`

That path is rewritten to backend, keeping auth/session behavior centralized in `autobot`.
