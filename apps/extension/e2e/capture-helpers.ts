import { REQUEST_TYPE } from '@redline/rpc';
import type { Page, Worker } from '@playwright/test';
import { expect } from './fixtures';
import { OverlayProbe } from './overlay-probe';

/** Asks the service worker to start capture in the tab showing `url`, as a UI page would. */
export const startCapture = async (extensionPage: Page, url: string): Promise<unknown> =>
  extensionPage.evaluate(
    async ({ type, pageUrl }) => {
      const [tab] = await chrome.tabs.query({ url: pageUrl });
      const reply: unknown = await chrome.runtime.sendMessage({
        type,
        id: 'e2e',
        method: 'capture.start',
        payload: { tabId: tab?.id },
      });
      return reply;
    },
    { type: REQUEST_TYPE, pageUrl: url },
  );

/**
 * Draws a closed rounded-rectangle lasso (a superellipse) 16px around the box: the way people
 * circle a wide row, as opposed to an ellipse through its corners that overshoots far past it.
 */
export const drawLassoAround = async (
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rx = box.width / 2 + 16;
  const ry = box.height / 2 + 16;
  const exponent = 2 / 8;
  const superellipse = (value: number) => Math.sign(value) * Math.abs(value) ** exponent;
  const point = (t: number) => ({
    x: cx + rx * superellipse(Math.cos(t)),
    y: cy + ry * superellipse(Math.sin(t)),
  });
  const start = point(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 48; i += 1) {
    const next = point((i / 48) * Math.PI * 2);
    await page.mouse.move(next.x, next.y);
  }
  await page.mouse.up();
};

/** Every record of an object store, read straight from the service worker's database. */
export const readStore = <T>(serviceWorker: Worker, store: string) =>
  serviceWorker.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('redline');
        open.onerror = () => {
          reject(new Error('cannot open database'));
        };
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            resolve(request.result);
          };
        };
      }),
    store,
  ) as Promise<T[]>;

/** Circles the elements, describes the step and saves it; resolves once the overlay is gone. */
export const captureStep = async (
  page: Page,
  extensionPage: Page,
  step: { readonly around: string; readonly comment: string },
) => {
  await page.bringToFront();
  const response = await startCapture(extensionPage, page.url());
  expect(response).toMatchObject({ result: { ok: true, value: { status: 'started' } } });
  await page.bringToFront();
  await expect(page.locator('redline-overlay')).toHaveCount(1);

  const boxes = await page.locator(step.around).evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );
  if (boxes.length === 0) throw new Error(`Nothing matches ${step.around}`);
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  await drawLassoAround(page, {
    x: left,
    y: top,
    width: Math.max(...boxes.map((b) => b.right)) - left,
    height: Math.max(...boxes.map((b) => b.bottom)) - top,
  });

  const probe = await OverlayProbe.attach(page);
  await expect
    .poll(async () => {
      const summary = await probe.text('shape-summaries');
      return summary !== null && summary !== '' && !summary.startsWith('Визначаю');
    })
    .toBe(true);
  // Type into the comment field itself rather than wherever focus happens to be.
  await probe.click('comment');
  await page.keyboard.type(step.comment);
  await probe.click('submit');
  await expect(page.locator('redline-overlay')).toHaveCount(0);
};
