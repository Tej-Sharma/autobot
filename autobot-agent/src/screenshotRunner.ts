import { chromium } from '@playwright/test';
import { getDevServerPort } from './devServer';
import { ScreenshotRequest, ScreenshotResult, ScreenshotPhase } from './types';

export async function captureScreenshots(req: ScreenshotRequest): Promise<ScreenshotResult> {
  const start = Date.now();
  const phases: ScreenshotPhase[] = [];
  const port = getDevServerPort();
  const baseUrl = req.baseUrl ?? (port ? `http://localhost:${port}` : null);

  if (!baseUrl) {
    return {
      success: false,
      phases: [],
      durationMs: Date.now() - start,
      error: 'No base URL available — dev server may not be running',
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
    });

    for (const route of req.routes) {
      for (const viewport of req.viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          reducedMotion: 'reduce',
          ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        const url = `${baseUrl}${route.path}`;

        try {
          // Initial load
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          try {
            await page.waitForLoadState('networkidle', { timeout: 20_000 });
          } catch {
            // network idle timeout is non-fatal
          }
          await page.waitForTimeout(600);

          const initialBuf = await page.screenshot({ fullPage: false });
          phases.push({
            routeKey: route.key,
            routePath: route.path,
            phase: 'initial-load',
            viewport: viewport.name,
            screenshotBase64: initialBuf.toString('base64'),
            url,
            status: 'captured',
          });

          // CTA interaction (smoke/full mode)
          if (req.mode !== 'minimal' && route.ctaSelectors?.length) {
            for (const selector of route.ctaSelectors) {
              try {
                const el = await page.$(selector);
                if (el) {
                  await el.click({ timeout: 5000 });
                  await page.waitForTimeout(1000);
                  const ctaBuf = await page.screenshot({ fullPage: false });
                  phases.push({
                    routeKey: route.key,
                    routePath: route.path,
                    phase: 'primary-cta',
                    viewport: viewport.name,
                    screenshotBase64: ctaBuf.toString('base64'),
                    url,
                    status: 'captured',
                  });
                  break;
                }
              } catch {
                // selector not found — try next
              }
            }
          }

          // Scroll screenshots (full mode)
          if (req.mode === 'full') {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);

            // Scroll to 40%
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight * 0.4);
            });
            await page.waitForTimeout(500);
            const midBuf = await page.screenshot({ fullPage: false });
            phases.push({
              routeKey: route.key,
              routePath: route.path,
              phase: 'scroll-mid',
              viewport: viewport.name,
              screenshotBase64: midBuf.toString('base64'),
              url,
              status: 'captured',
            });

            // Scroll to bottom
            await page.evaluate(() => {
              window.scrollTo(0, document.body.scrollHeight);
            });
            await page.waitForTimeout(500);
            const bottomBuf = await page.screenshot({ fullPage: false });
            phases.push({
              routeKey: route.key,
              routePath: route.path,
              phase: 'scroll-bottom',
              viewport: viewport.name,
              screenshotBase64: bottomBuf.toString('base64'),
              url,
              status: 'captured',
            });
          }
        } catch (err) {
          phases.push({
            routeKey: route.key,
            routePath: route.path,
            phase: 'initial-load',
            viewport: viewport.name,
            screenshotBase64: '',
            url,
            status: 'failed',
            error: err instanceof Error ? err.message : 'screenshot failed',
          });
        } finally {
          await context.close();
        }
      }
    }

    return {
      success: phases.some((p) => p.status === 'captured'),
      phases,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      phases,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'browser launch failed',
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
