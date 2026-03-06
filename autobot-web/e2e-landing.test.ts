import { test, expect } from "@playwright/test";

const BASE = "http://localhost:4173";

test.describe("Landing Page — Product-Led Growth Funnel", () => {
  test("renders hero with URL input and trust signals", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Headline
    await expect(page.locator("h1")).toContainText("Find Bugs Before");
    await expect(page.locator("h1")).toContainText("Your Users Do");

    // Subtitle
    await expect(page.getByText("AI-powered QA testing in 30 seconds")).toBeVisible();

    // URL input
    const input = page.getByPlaceholder("https://your-app.com");
    await expect(input).toBeVisible();

    // CTA button
    await expect(page.getByRole("button", { name: /Test My App/i })).toBeVisible();

    // Trust signals
    await expect(page.getByText("Screenshots + AI Analysis")).toBeVisible();
    await expect(page.getByText("No credit card")).toBeVisible();
    await expect(page.getByText("Results in 60s")).toBeVisible();
  });

  test("validates empty URL submission", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /Test My App/i }).click();
    await expect(page.getByText("Please enter a URL")).toBeVisible();
  });

  test("validates invalid URL submission", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    const input = page.getByPlaceholder("https://your-app.com");
    await input.fill("://broken");
    await page.getByRole("button", { name: /Test My App/i }).click();
    await expect(page.getByText("Please enter a valid URL")).toBeVisible();
  });

  test("submits URL and shows loading state then navigates to /run/", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Intercept the /api/qa/try call — mock a successful response
    await page.route("**/api/qa/try", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, jobId: "test-job-123", remaining: 2 }),
      });
    });

    const input = page.getByPlaceholder("https://your-app.com");
    await input.fill("https://www.constella.app/");
    await page.getByRole("button", { name: /Test My App/i }).click();

    // Should navigate to run page (mock responds instantly so loading state is transient)
    await page.waitForURL("**/run/test-job-123", { timeout: 5000 });
    expect(page.url()).toContain("/run/test-job-123");
  });

  test("shows rate limit error on 429", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await page.route("**/api/qa/try", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "rate_limit", retryAfterSec: 3600 }),
      });
    });

    const input = page.getByPlaceholder("https://your-app.com");
    await input.fill("https://www.constella.app/");
    await page.getByRole("button", { name: /Test My App/i }).click();

    await expect(page.getByText("Rate limit reached")).toBeVisible();
  });

  test("navbar has correct links", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("link", { name: /Test Your App Free/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "How It Works" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
  });
});

test.describe("Run Page — Progress + Results", () => {
  test("shows progress steps while polling", async ({ page }) => {
    let pollCount = 0;

    await page.route("**/api/qa/jobs/job-progress-test", async (route) => {
      pollCount++;
      const status = pollCount < 3 ? "running" : "running";
      const messages = ["preparing queue entry", "crawling routes", "capturing screenshots", "judging with AI"];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "job-progress-test",
          status,
          progressMessage: messages[Math.min(pollCount - 1, messages.length - 1)],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto(`${BASE}/run/job-progress-test`);
    await page.waitForLoadState("networkidle");

    // Should show progress UI
    await expect(page.getByText("Testing in progress")).toBeVisible();
    await expect(page.getByText("Analyzing your app...")).toBeVisible();

    // Should show step labels
    await expect(page.getByText("Preparing...")).toBeVisible();
    await expect(page.getByText("Crawling pages...")).toBeVisible();
    await expect(page.getByText("Capturing screenshots...")).toBeVisible();
    await expect(page.getByText("Running AI analysis...")).toBeVisible();
  });

  test("shows results when job succeeds", async ({ page }) => {
    await page.route("**/api/qa/jobs/job-results-test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "job-results-test",
          status: "succeeded",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          report: {
            baseUrl: "https://www.constella.app",
            phases: [
              {
                routeKey: "home",
                routePath: "/",
                viewport: "desktop",
                screenshotPath: "home-desktop.png",
                status: "captured",
                url: "https://www.constella.app/",
                phase: "initial",
                judge: {
                  score: 85,
                  confidence: 0.9,
                  findings: [
                    {
                      severity: "medium",
                      category: "accessibility",
                      message: "Missing alt text on hero image",
                      suggestion: "Add descriptive alt text to the hero image for screen readers",
                    },
                    {
                      severity: "low",
                      category: "performance",
                      message: "Large unoptimized image detected",
                      suggestion: "Consider using next/image or WebP format",
                    },
                  ],
                  notes: "Overall good quality",
                },
              },
            ],
            totals: {
              score: 85,
              blocking: 0,
              high: 0,
              medium: 1,
              low: 1,
              capturedPhases: 1,
              failedPhases: 0,
            },
          },
        }),
      });
    });

    await page.goto(`${BASE}/run/job-results-test`);
    await page.waitForLoadState("networkidle");

    // Score badge (use first() since score appears in badge + phase card)
    await expect(page.getByText("85").first()).toBeVisible();
    await expect(page.getByText("QA Score")).toBeVisible();
    await expect(page.getByText("https://www.constella.app")).toBeVisible();

    // Severity summary
    await expect(page.getByText("1 medium")).toBeVisible();
    await expect(page.getByText("1 low")).toBeVisible();

    // Screenshots section
    await expect(page.getByRole("heading", { name: "Screenshots" })).toBeVisible();

    // Findings
    await expect(page.getByText("Findings (2)")).toBeVisible();
    await expect(page.getByText("Missing alt text on hero image")).toBeVisible();

    // Expand a finding
    await page.getByText("Missing alt text on hero image").click();
    await expect(page.getByText("Add descriptive alt text")).toBeVisible();

    // Email capture section
    await expect(page.getByText("Get the full report emailed")).toBeVisible();
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(page.getByRole("button", { name: /Send Report/i })).toBeVisible();

    // Upgrade CTA
    await expect(page.getByText("Daily Automated Monitoring")).toBeVisible();
    await expect(page.getByRole("button", { name: /Upgrade to Pro/i })).toBeVisible();

    // Try another button
    await expect(page.getByRole("link", { name: /Test Another App/i })).toBeVisible();
  });

  test("shows failed state with try again", async ({ page }) => {
    await page.route("**/api/qa/jobs/job-failed-test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "job-failed-test",
          status: "failed",
          error: "Browser timed out while loading the page",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto(`${BASE}/run/job-failed-test`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Test Run Failed")).toBeVisible();
    await expect(page.getByText("Browser timed out")).toBeVisible();
    await expect(page.getByRole("link", { name: /Try Again/i })).toBeVisible();
  });
});
