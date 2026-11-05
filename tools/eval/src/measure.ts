import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { CorpusApp, EvalCase } from './corpus';
import type { HarnessApi, HarnessResult } from './harness/api';

const ORIGIN = 'https://eval.test';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export interface CaseMeasurement {
  readonly case: EvalCase;
  readonly result: HarnessResult;
}

/** Opens built apps in Chromium and runs the harness around each case's element. */
export class Measurer {
  private constructor(
    private readonly browser: Browser,
    private readonly harness: string,
  ) {}

  static async launch(harnessFile: string): Promise<Measurer> {
    return new Measurer(await chromium.launch(), await readFile(harnessFile, 'utf8'));
  }

  async measure(app: CorpusApp, buildDir: string): Promise<CaseMeasurement[]> {
    const context = await this.browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route(`${ORIGIN}/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      const file = path.join(buildDir, pathname === '/' ? 'index.html' : pathname);
      try {
        await route.fulfill({
          body: await readFile(file),
          contentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
        });
      } catch {
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`${ORIGIN}/`);
      await this.rendered(page, app, errors);
      await page.addScriptTag({ content: this.harness });
      const measurements: CaseMeasurement[] = [];
      for (const evalCase of app.cases) {
        measurements.push({ case: evalCase, result: await this.anchorsOf(page, app, evalCase) });
      }
      return measurements;
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  /** Waits for the app's first render; a crashed app fails the run instead of scoring zero. */
  private async rendered(page: Page, app: CorpusApp, errors: string[]): Promise<void> {
    try {
      await page.waitForFunction(() => document.body.innerText.trim().length > 0, null, {
        timeout: 10_000,
      });
      await page.waitForLoadState('networkidle');
    } catch (cause) {
      throw new Error(`${app.name} did not render: ${errors.join('; ') || String(cause)}`, {
        cause,
      });
    }
  }

  private async anchorsOf(page: Page, app: CorpusApp, evalCase: EvalCase): Promise<HarnessResult> {
    const target = page.locator(evalCase.circle).first();
    try {
      await target.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch (cause) {
      throw new Error(`${app.name}/${evalCase.id}: nothing matches ${evalCase.circle}`, { cause });
    }
    const box = await target.boundingBox();
    if (box === null) throw new Error(`${app.name}/${evalCase.id}: the element is not rendered`);
    return page.evaluate(
      (rect) => (window as unknown as { redlineEval: HarnessApi }).redlineEval.anchorsAround(rect),
      box,
    );
  }
}
