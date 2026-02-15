# Autobot Web Console

Standalone landing + dashboard for onboarding users into GitHub + webhook setup.

## What it does

- Shows the AI PR Testing landing page.
- `Start Now` starts GitHub OAuth flow.
- After OAuth callback, users return directly to the dashboard.
- Dashboard lets users:
  - view connected GitHub identity,
  - pick repos where they have admin access,
  - create/update repository webhooks to the Render Autobot endpoint.

## Runtime

- Web app: `autobot-web`
- Runtime API surface:
  - `/api/*` is proxied to the backend `autobot` service.
  - Console endpoints now live in `autobot/src/consoleApi.ts`.

## Setup

1. Copy `.env.example` to `.env` and fill:

```bash
cp autobot-web/.env.example autobot-web/.env
```

2. Create a GitHub OAuth App in backend (`autobot`) and set redirect URI to:
   - `https://autobot.it.com/api/auth/github/callback`
3. Copy values to `.env`.
4. Run:

```bash
cd autobot-web
npm install
npm run dev
```

5. Open `http://localhost:4173`.

## Open-source + self-hosting notes

- Keep `autobot-web/.env` local-only for development.
- Use your platform secret store in production and pass vars at runtime.
- Verify env files are not tracked before publishing:
  - `git status --short`
  - `git check-ignore -v autobot-web/.env`
- Use HTTPS and OAuth credentials for public deployments.
- For local testing of webhook/OAuth flows, use tunnel tools (`ngrok`, `cloudflared`, `tailscale serve`) and set `APP_BASE_URL` in the backend (`autobot`) to the tunnel host.

## Important env vars

- `AUTOBOT_API_BASE_URL` (Autobot service URL, e.g. `https://autobot-er1m.onrender.com`)

## Flow after install

1. User clicks **Install on GitHub**.
2. OAuth callback completes and stores session cookie.
3. Dashboard loads with repo list.
4. User selects repos and clicks **Enable webhook on selected repos**.
- This also registers each selected repo + logged-in user OAuth token in Autobot backend.
5. Service creates/updates webhook for selected repos using:
   - URL: `AUTOBOT_WEBHOOK_URL` (configured on the backend `autobot`)
   - Events: `pull_request`, `issue_comment`
6. Optional: click **Run now on selected repos (default branch)** with your deployment URL to queue immediate jobs for each selected repo.
7. Returning visitors are automatically shown the dashboard because of the session check.

Notes:

- No PAT is required for normal users. OAuth tokens are stored in backend token mapping and used to post PR comments for the triggering actor.
- Configure `GITHUB_TOKEN` in backend only if you want a fallback reviewer token for cases where actor token is missing.

## Run now behavior

- Click **Run now on selected repos (default branch)** after selecting repos.
- `autobot-web` (via backend) sends one run request per repo to `AUTOBOT_API_BASE_URL/api/runs/default-branch` with:
  - `environment: custom`
  - `branch: <repo default branch>`
  - `baseUrl: <URL entered in dashboard>`
  - `mode: smoke` and `includeJudge: true`
- This gives you immediate job IDs and status URLs in the dashboard results.
