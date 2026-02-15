import { Browser, BrowserContext, chromium, Page } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePathForPhase } from './reporter';
import { buildAbsoluteUrl, slugify } from './utils';
import { ManifestMatch, PhaseRecord, RunMode, ViewportSetting } from './types';

interface PlaywrightInput {
  jobId: string;
  runDir: string;
  baseUrl: string;
  routeConfigs: ManifestMatch[];
  mode: RunMode;
  viewports: ViewportSetting[];
}

const waitStable = async (page: Page, timeout = 1200): Promise<void> => {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // continue on timeout.
  }
  await page.waitForTimeout(600);
};

const clickBySelectors = async (page: Page, selectors: string[]): Promise<{ selector: string | null; clicked: boolean }> => {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      const count = await locator.count();
      if (!count) continue;
      if (!(await locator.isVisible({ timeout: 750 }))) continue;
      await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => void 0);
      await locator.click({ timeout: 1500 });
      return { selector, clicked: true };
    } catch {
      // Search for next selector
    }
  }
  return { selector: null, clicked: false };
};

const capture = async (page: Page, filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, fullPage: true, animations: 'disabled' });
};

export async function runVisualChecks(input: PlaywrightInput): Promise<PhaseRecord[]> {
  const phaseRecords: PhaseRecord[] = [];
  const browser = (await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
  })) as Browser;

  try {
    for (const routeMatch of input.routeConfigs) {
      for (const viewport of input.viewports) {
        const routeDir = path.join(input.runDir, slugify(routeMatch.spec.key), slugify(viewport.name));
        const context = (await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          reducedMotion: 'reduce',
          ignoreHTTPSErrors: true,
        })) as BrowserContext;
        const page = await context.newPage();
        const routeLabel = routeMatch.spec.key;
        const routePath = routeMatch.spec.path;
        const absoluteRoute = buildAbsoluteUrl(input.baseUrl, routePath);

        const recordBase = (phase: string, status: PhaseRecord['status'], extra: Partial<PhaseRecord> = {}): PhaseRecord => ({
          routeKey: routeLabel,
          routePath,
          phase,
          viewport: viewport.name,
          screenshotPath: capturePathForPhase(input.jobId, routeDir, phase),
          url: absoluteRoute,
          status,
          ...extra,
        });

        try {
          await page.goto(absoluteRoute, {
            waitUntil: 'domcontentloaded',
            timeout: 35000,
          });
          await waitStable(page, 20000);

          const initialPath = capturePathForPhase(input.jobId, routeDir, 'initial-load');
          await capture(page, initialPath);
          phaseRecords.push(
            recordBase('initial-load', 'captured', {
              screenshotPath: initialPath,
            }),
          );

          const shouldDoActions = input.mode !== 'minimal';
          if (!shouldDoActions) {
            continue;
          }

          const ctas = (routeMatch.spec.ctaSelectors ?? []).slice(0, 4);
          const firstCta = await clickBySelectors(page, ctas);
          if (firstCta.clicked) {
            await waitStable(page, 12000);
            const afterClickPath = capturePathForPhase(input.jobId, routeDir, 'primary-cta');
            await capture(page, afterClickPath);
            phaseRecords.push(
              recordBase('primary-cta', 'captured', {
                screenshotPath: afterClickPath,
              }),
            );
          } else {
            phaseRecords.push(
              recordBase('primary-cta-missing', 'skipped', {
                error: 'No matching CTA selector found for safe interaction',
              }),
            );
          }

          if (input.mode === 'full') {
            await page.keyboard.press('Escape').catch(() => void 0);
            await waitStable(page, 800);
            const afterInteractPath = capturePathForPhase(input.jobId, routeDir, 'after-interaction');
            await capture(page, afterInteractPath);
            phaseRecords.push(
              recordBase('after-interaction', 'captured', {
                screenshotPath: afterInteractPath,
              }),
            );
          }

          await page.evaluate(() => {
            window.scrollTo({ top: Math.max(0, Math.floor(document.body.scrollHeight * 0.4)), behavior: 'auto' });
          });
          await waitStable(page, 700);
          const midPath = capturePathForPhase(input.jobId, routeDir, 'scroll-mid');
          await capture(page, midPath);
          phaseRecords.push(
            recordBase('scroll-mid', 'captured', {
              screenshotPath: midPath,
            }),
          );

          await page.evaluate(() => {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
          });
          await waitStable(page, 700);
          const bottomPath = capturePathForPhase(input.jobId, routeDir, 'scroll-bottom');
          await capture(page, bottomPath);
          phaseRecords.push(
            recordBase('scroll-bottom', 'captured', {
              screenshotPath: bottomPath,
            }),
          );
        } catch (error) {
          phaseRecords.push(
            recordBase('route-failed', 'failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        } finally {
          await page.close().catch(() => void 0);
          await context.close().catch(() => void 0);
        }
      }
    }
  } finally {
    await browser.close().catch(() => void 0);
  }

  return phaseRecords;
}
