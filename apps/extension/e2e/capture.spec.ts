import { REQUEST_TYPE } from '@redline/rpc';
import type { Page } from '@playwright/test';
import { SITE_ORIGIN, expect, test } from './fixtures';
import { OverlayProbe } from './overlay-probe';

const startCapture = async (extensionPage: Page, url: string): Promise<unknown> =>
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
const drawLassoAround = async (
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

const pageUrl = `${SITE_ORIGIN}/pricing.html`;

test('circling cards resolves them, and a described step is committed', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  await page.goto(pageUrl);

  const response = await startCapture(extensionPage, pageUrl);
  expect(response).toMatchObject({ result: { ok: true, value: { status: 'started' } } });
  await page.bringToFront();
  await expect(page.locator('redline-overlay')).toHaveCount(1);

  const cards = page.getByTestId('plan-card');
  const first = await cards.nth(0).boundingBox();
  const last = await cards.nth(2).boundingBox();
  if (first === null || last === null) throw new Error('fixture cards are not rendered');
  await drawLassoAround(page, {
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: first.height,
  });

  const probe = await OverlayProbe.attach(page);
  await expect.poll(() => probe.text('shape-summaries')).toBe('article[data-testid=plan-card] ×3');

  await page.keyboard.type('Make the cards equal height');
  await probe.click('intent-layout');
  await probe.click('submit');

  await expect(page.locator('redline-overlay')).toHaveCount(0);
  expect(logs.some((line) => line.includes('[redline:capture] Step captured'))).toBe(true);
});

test('submitting without a description keeps the composer open with a hint', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  await page.goto(pageUrl);
  await startCapture(extensionPage, pageUrl);
  await page.bringToFront();

  const card = await page.getByTestId('enterprise-card').boundingBox();
  if (card === null) throw new Error('fixture card is not rendered');
  await drawLassoAround(page, card);

  const probe = await OverlayProbe.attach(page);
  await expect
    .poll(() => probe.text('shape-summaries'))
    .toBe('article[data-testid=enterprise-card]');
  await probe.click('submit');

  await expect.poll(() => probe.text('problem')).toBe('Опишіть, що потрібно змінити');
  await expect(page.locator('redline-overlay')).toHaveCount(1);
});

test('starting twice keeps one session, and Escape twice leaves capture', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  await page.goto(pageUrl);

  expect(await startCapture(extensionPage, pageUrl)).toMatchObject({
    result: { value: { status: 'started' } },
  });
  expect(await startCapture(extensionPage, pageUrl)).toMatchObject({
    result: { value: { status: 'already-active' } },
  });
  await page.bringToFront();
  await expect(page.locator('redline-overlay')).toHaveCount(1);

  const card = await page.getByTestId('enterprise-card').boundingBox();
  if (card === null) throw new Error('fixture card is not rendered');
  await drawLassoAround(page, card);
  await page.keyboard.press('Escape'); // discards the step, back to armed
  await expect(page.locator('redline-overlay')).toHaveCount(1);
  await page.keyboard.press('Escape'); // leaves capture
  await expect(page.locator('redline-overlay')).toHaveCount(0);
});
