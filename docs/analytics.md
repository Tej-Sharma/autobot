# PostHog Analytics Events

## Setup

- Provider: [PostHog](https://posthog.com)
- Integration: `posthog-js` via `PostHogProvider` in `app/layout.tsx`
- Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`

## Auto-captured Events

PostHog automatically captures:
- **Pageviews** — every route change
- **Page leaves** — when users navigate away
- **Clicks** — autocapture on interactive elements

## Custom Events

### Landing Page (`app/page.tsx`)

| Event | Trigger | Properties |
|-------|---------|------------|
| `free_test_submitted` | User submits URL for free test | `url` |
| `free_test_started` | Test successfully queued | `url`, `job_id` |
| `free_test_rate_limited` | 429 response | `url` |
| `free_test_error` | Non-429 error | `url`, `error` |

### Results Page (`app/run/[jobId]/page.tsx`)

| Event | Trigger | Properties |
|-------|---------|------------|
| `test_results_viewed` | Report loads for first time | `job_id`, `score`, `base_url`, `findings_count` |
| `email_report_submitted` | User submits email for report | `job_id`, `email` |
| `upgrade_to_pro_clicked` | Clicks upgrade button | `source: "results_page"`, `job_id` |

### Dashboard (`app/me/page.tsx`)

| Event | Trigger | Properties |
|-------|---------|------------|
| `dashboard_login` | User enters email to access dashboard | `email` |
| `upgrade_to_pro_clicked` | Clicks upgrade button | `source: "dashboard"`, `email` |
| `monitor_added` | User adds a monitored URL | `url`, `interval_hours`, `has_credentials` |
| `monitor_deleted` | User deletes a monitored URL | `url` |

## User Identification

`posthog.identify(email)` is called when users:
- Submit their email on the results page (email capture form)
- Log in on the dashboard page
