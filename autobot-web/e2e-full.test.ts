import { test, expect } from "@playwright/test";

const BASE = "http://localhost:4173";

test.describe("Full E2E — First-time user submits URL", () => {
  test("user pastes URL, sees progress, then results with screenshots", async ({ page }) => {
    // Increase timeout for real backend processing
    test.setTimeout(120_000);

    // 1. Land on the home page
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Verify hero is visible
    await expect(page.locator("h1")).toContainText("Find Bugs Before");
    const input = page.getByPlaceholder("https://your-app.com");
    await expect(input).toBeVisible();

    // 2. Type the URL and submit
    await input.fill("https://www.constella.app/");
    const submitBtn = page.getByRole("button", { name: /Test My App/i });
    await submitBtn.click();

    // 3. Should navigate to /run/{jobId}
    await page.waitForURL("**/run/**", { timeout: 10_000 });
    const runUrl = page.url();
    console.log("Navigated to:", runUrl);
    expect(runUrl).toMatch(/\/run\/[a-z0-9]+/);

    // 4. Should show progress UI
    await expect(page.getByText("Testing in progress")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Analyzing your app...")).toBeVisible();

    // Verify progress steps are rendered
    await expect(page.getByText("Preparing...")).toBeVisible();
    await expect(page.getByText("Crawling pages...")).toBeVisible();
    await expect(page.getByText("Capturing screenshots...")).toBeVisible();
    await expect(page.getByText("Running AI analysis...")).toBeVisible();

    // 5. Wait for the run to complete — poll until we see results
    // The page auto-polls every 2s, so we just wait for the score to appear
    await expect(page.getByText("QA Score")).toBeVisible({ timeout: 90_000 });
    console.log("Results loaded!");

    // 6. Verify results page content
    // Score badge should be visible (score of 100 since OpenAI isn't configured)
    await expect(page.getByText("QA Score")).toBeVisible();

    // Base URL shown
    await expect(page.getByText("https://www.constella.app")).toBeVisible();

    // Screenshots section
    await expect(page.getByText("Screenshots")).toBeVisible();

    // Should have at least one screenshot image rendered
    const screenshots = page.locator("img[loading='lazy']");
    const count = await screenshots.count();
    console.log(`Found ${count} screenshot(s)`);
    expect(count).toBeGreaterThan(0);

    // Verify at least one screenshot loaded successfully (non-zero dimensions)
    const firstImg = screenshots.first();
    await expect(firstImg).toBeVisible();

    // Route label should be visible
    await expect(page.getByText("/").first()).toBeVisible();

    // Teasers should be present
    await expect(page.getByText("Coming soon")).toHaveCount(2);

    // "Test Another App" button
    await expect(page.getByRole("link", { name: /Test Another App/i })).toBeVisible();

    console.log("Full E2E test passed!");
  });
});
