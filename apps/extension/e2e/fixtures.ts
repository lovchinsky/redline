import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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

const require = createRequire(import.meta.url);

/** Fixture site resources that are not HTML files: a framework build and a failing API. */
const SPECIAL_ROUTES: Readonly<
  Record<string, () => Promise<{ status?: number; body: string | Buffer; contentType: string }>>
> = {
  '/vendor/vue.global.js': async () => ({
    body: await readFile(require.resolve('vue/dist/vue.global.js')),
    contentType: 'text/javascript',
  }),
  '/api/prices': () =>
    Promise.resolve({ status: 500, body: '{"error":"boom"}', contentType: 'application/json' }),
};

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
    const { pathname } = new URL(route.request().url());
    const special = SPECIAL_ROUTES[pathname];
    if (special !== undefined) {
      await route.fulfill(await special());
      return;
    }
    const file = path.join(siteDir, pathname);
    await route.fulfill({ body: await readFile(file), contentType: 'text/html; charset=utf-8' });
  });
  return context;
};

export const serviceWorkerOf = async (context: BrowserContext): Promise<Worker> =>
  context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

const openExtensionPage = async (context: BrowserContext, path: string): Promise<Page> => {
  const extensionId = new URL((await serviceWorkerOf(context)).url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
};

export const openSidePanel = (context: BrowserContext): Promise<Page> =>
  openExtensionPage(context, 'sidepanel.html');

export const openOptions = (context: BrowserContext): Promise<Page> =>
  openExtensionPage(context, 'options.html');

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
