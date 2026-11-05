import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

/** Launches Chromium with the built extension (`wxt build` must run first). */
export const test = base.extend<ExtensionFixtures>({
  // Playwright requires object destructuring for fixture dependencies, even when there are none.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
