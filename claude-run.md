# AI App Tester — First Run Log

**Date:** 2026-02-18
**Command:** `./app-test.sh http://localhost:4173 --codebase ./autobot-web`
**Total Cost:** $1.8532
**Duration:** ~11 minutes (11:29 PM → 11:40 PM)

---

## Run Summary

| Phase | Cost | Duration | Output |
|-------|------|----------|--------|
| Phase 1: Codebase Analysis | $0.4142 | ~2 min | `autobot-web-TESTER.md` (21,832 bytes) |
| Phase 2: Test Execution | $1.4390 | ~9 min | 22 screenshots, test report |
| **Total** | **$1.8532** | **~11 min** | Full QA report |

## Results

- **Status:** PARTIAL — 9/20 flows passed, 2 failed, 9 not testable (require real GitHub OAuth)
- **22 screenshots** captured in `autobot/artifacts/app-test-1771399555040/screenshots/`
- **Full report:** `autobot/artifacts/app-test-1771399555040/agent-test-report.md`
- **JSON report:** `autobot/artifacts/app-test-1771399555040/agent-test-report.json`
- **Cached TESTER.md:** `autobot/artifacts/testers/autobot-web-TESTER.md`

## Findings

### Blocking
1. **OAuth callback URL hardcoded to production** — `redirect_uri` points to `https://autobot.it.com/api/auth/github/callback` instead of localhost. OAuth cannot complete locally.

### Medium
2. **Nav links are placeholders** — Product, Integration, Pricing, Docs all go to `/#`
3. **View Demo button has no action** — No scroll or modal triggered

### Low
4. **API `/api/environments` returns "not found" instead of "unauthorized"** — Inconsistent with other protected endpoints
5. **Footer GitHub link may open in same tab** — Inconsistent with navbar version

## Flows Tested

| # | Flow | Status |
|---|------|--------|
| 1 | Landing Page Visit | PASS |
| 2 | GitHub OAuth Login | PARTIAL — redirect works, callback URL wrong |
| 3 | Navbar Connect GitHub Button | PASS |
| 4 | Authenticated Redirect from Landing | NOT TESTED — needs OAuth |
| 5 | Dashboard Load + Repo List | NOT TESTED — needs OAuth |
| 6 | Auth Guard (Dashboard redirect) | PASS |
| 7 | Repository Checkboxes | NOT TESTED — needs OAuth |
| 8 | Webhook Sync | NOT TESTED — needs OAuth |
| 9 | Run Now | NOT TESTED — needs OAuth |
| 10 | Logout | NOT TESTED — needs OAuth |
| 11 | Health Check Endpoint | PASS |
| 12 | Navigation Links | PARTIAL — placeholder links |
| 13 | Dashboard Navbar Links | NOT TESTED — needs OAuth |
| 14 | Pipeline Demo Animation | PASS |
| 15 | Integrations Section | PASS |
| 16 | How It Works Section | PASS |
| 17 | Footer Links | PASS |
| 18 | Session Persistence | NOT TESTED — needs OAuth |
| 19 | Invalid Session Cookie | PASS |
| 20 | API Proxy / Backend | PASS |

## Console Output

```
[11:29:21 PM] [Phase 1] Budget: $1.50
[11:29:21 PM] [Phase 1] Analysis complete. Cost: $0.4142
[11:29:21 PM] [Phase 1] TESTER.md saved (21832 bytes)
[11:29:21 PM] [Phase 2] Testing app with agent-browser...
[11:29:24 PM] [Phase 2] Starting systematic testing...
  ... (22 screenshots captured, 14 API routes tested)
[11:40:14 PM] [Phase 2] Testing complete. Cost: $1.4390
[11:40:15 PM] [Phase 3] Screenshots captured: 22
[11:40:15 PM] [Phase 3] Status: partial | Flows: 9/20 passed | Findings: 5
[11:40:15 PM] [Main] Done. Total cost: $1.8532
```

## Notes

- Second run on the same codebase will skip Phase 1 (reuse cached TESTER.md), saving ~$0.41
- To test authenticated flows, pass credentials: `--credentials '{"email":"...","password":"..."}'`
- To force re-analysis: `--force-analysis`
- Model used: `claude-sonnet-4-6`
