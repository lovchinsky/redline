import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** The e2e build: production code plus host access to the fixture origin. */
const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3-e2e');
const siteDir = path.resolve(import.meta.dirname, 'site');

/** Fixture pages are served from this origin, which the e2e build may access. */
export const SITE_ORIGIN = 'https://redline.test';

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  /** An extension page, used as the RPC caller a real UI (side panel) would be. */
  extensionPage: Page;
}

/**
 * Starts Chromium with the extension and the fixture site. `userDataDir` '' is a throwaway
 * profile; pass a directory to keep the profile across launches (a browser restart).
 */
export const launchExtension = async (userDataDir = ''): Promise<BrowserContext> => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route(`${SITE_ORIGIN}/**`, async (route) => {
    const file = path.join(siteDir, new URL(route.request().url()).pathname);
    await route.fulfill({ body: await readFile(file), contentType: 'text/html; charset=utf-8' });
  });
  return context;
};

export const serviceWorkerOf = async (context: BrowserContext): Promise<Worker> =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

export const openSidePanel = async (context: BrowserContext): Promise<Page> => {
  const extensionId = new URL((await serviceWorkerOf(context)).url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
};

export const test = base.extend<ExtensionFixtures>({
  // Playwright requires object destructuring for fixture dependencies, even when there are none.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await launchExtension();
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    await use(await serviceWorkerOf(context));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  extensionPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await use(page);
  },
});

export const expect = test.expect;
