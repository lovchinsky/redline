import type { Worker } from '@playwright/test';
import { composerOf, drawLassoAround, readStore, startCapture } from './capture-helpers';
import { SITE_ORIGIN, expect, openOptions, test } from './fixtures';
import { OverlayProbe } from './overlay-probe';

const pageUrl = `${SITE_ORIGIN}/pricing.html`;

interface StoredCapture {
  capture: {
    fragments: { kind: string; data: unknown; assets: { id: string }[] }[];
    diagnostics: { source: string; outcome: string }[];
  };
}

interface StoredTask {
  steps: { comment: string; captureId: string }[];
}

/** Pixel size of a stored image asset, decoded in the service worker. */
const imageSize = (serviceWorker: Worker, assetId: string) =>
  serviceWorker.evaluate(
    (id) =>
      new Promise<{ width: number; height: number; type: string }>((resolve, reject) => {
        const open = indexedDB.open('redline');
        open.onsuccess = () => {
          const request = open.result.transaction('assets').objectStore('assets').get(id);
          request.onsuccess = async () => {
            const { data } = request.result as { data: Blob };
            const bitmap = await createImageBitmap(data);
            resolve({ width: bitmap.width, height: bitmap.height, type: data.type });
          };
          request.onerror = () => {
            reject(new Error('missing asset'));
          };
        };
      }),
    assetId,
  );

test('circling cards collects context and adds the step to a draft with real screenshots', async ({
  context,
  extensionPage,
  serviceWorker,
}) => {
  const page = await context.newPage();
  const logs: string[] = [];
  page.on('console', (message) => logs.push(message.text()));
  await page.goto(pageUrl);
  await page.bringToFront();

  const response = await startCapture(extensionPage, pageUrl);
  expect(response).toMatchObject({ result: { ok: true, value: { status: 'started' } } });
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

  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'article[data-testid=plan-card] ×3',
  );
  // The comment field takes focus by itself.
  await expect(composer.getByTestId('comment')).toBeFocused();
  await page.keyboard.type('Make the cards equal height');
  await composer.getByTestId('submit').click();

  await expect(page.locator('redline-overlay')).toHaveCount(0);
  await expect
    .poll(() => logs.some((line) => line.includes('[redline:capture] Step added to draft')))
    .toBe(true);

  const [task] = await readStore<StoredTask>(serviceWorker, 'tasks');
  expect(task?.steps).toMatchObject([{ comment: 'Make the cards equal height' }]);
  const stored = (await readStore<StoredCapture & { id: string }>(serviceWorker, 'captures')).find(
    (record) => record.id === task?.steps[0]?.captureId,
  );
  // A plain static page: no framework, no errors, no failed requests. Nothing failed.
  expect(stored?.capture.diagnostics.map((d) => [d.source, d.outcome]).sort()).toEqual([
    ['framework', 'not-applicable'],
    ['network-failures', 'not-applicable'],
    ['runtime-errors', 'not-applicable'],
  ]);
  expect(stored?.capture.fragments.map((f) => f.kind).sort()).toEqual([
    'anchors',
    'computed-styles',
    'css-rules',
    'dom-snapshot',
    'layout',
    'page-meta',
    'region',
    'screenshot',
  ]);
  const screenshot = stored?.capture.fragments.find((f) => f.kind === 'screenshot');
  const [crop, overview] = screenshot?.assets ?? [];
  if (crop === undefined || overview === undefined) throw new Error('screenshot assets missing');
  expect(await imageSize(serviceWorker, crop.id)).toMatchObject({ type: 'image/png' });
  const overviewSize = await imageSize(serviceWorker, overview.id);
  expect(overviewSize.type).toBe('image/webp');
  expect(overviewSize.width).toBeGreaterThan(overviewSize.height);
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

  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'article[data-testid=enterprise-card]',
  );
  await composer.getByTestId('submit').click();

  await expect(composer.getByTestId('problem')).toHaveText('Опишіть, що потрібно змінити');
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

test('choosing an element with the keyboard instead of drawing, then Diagnostics', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  await page.goto(pageUrl);
  await startCapture(extensionPage, pageUrl);
  await page.bringToFront();
  const probe = await OverlayProbe.attach(page);
  await expect.poll(() => probe.text('hint')).toContain('Tab');

  await page.keyboard.press('Tab'); // starts on the first element on screen
  await expect.poll(() => probe.text('cursor')).toBe('Елемент: nav');
  await page.keyboard.press('Shift+Tab'); // wraps around to the last one
  await expect.poll(() => probe.text('cursor')).toBe('Елемент: p');
  await page.keyboard.press('ArrowUp'); // out to its card
  await expect
    .poll(() => probe.text('cursor'))
    .toBe('Елемент: article[data-testid=enterprise-card]');
  await page.keyboard.press('Enter');

  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'article[data-testid=enterprise-card]',
  );
  // The comment field takes focus: the step is described and saved without the pointer.
  await expect(composer.getByTestId('comment')).toBeFocused();
  await page.keyboard.type('Rename Enterprise to Business');
  await page.keyboard.press('Enter');
  await expect(page.locator('redline-overlay')).toHaveCount(0);

  const options = await openOptions(context);
  const record = options.getByTestId('capture-record').first();
  await expect(record).toContainText('https://redline.test/pricing.html');
  await record.locator('summary').click();
  await expect(record.locator('tr[data-outcome="collected"]').first()).toBeVisible();
  await expect(record.getByText('anchors')).toBeVisible();
});

test('a page cannot see what the user types in the composer', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  // What session-replay and analytics scripts do: listen to every key in the capture phase.
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    for (const target of [window, document]) {
      for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input']) {
        target.addEventListener(
          type,
          (event) => {
            seen.push(
              event instanceof KeyboardEvent ? event.key : ((event as InputEvent).data ?? ''),
            );
          },
          { capture: true },
        );
      }
    }
  });
  await page.goto(pageUrl);
  await startCapture(extensionPage, pageUrl);
  await page.bringToFront();
  const card = await page.getByTestId('enterprise-card').boundingBox();
  if (card === null) throw new Error('fixture card is not rendered');
  await drawLassoAround(page, card);

  const composer = await composerOf(page);
  await expect(composer.getByTestId('comment')).toBeFocused();
  await page.keyboard.type('secret plan');
  await expect(composer.getByTestId('comment')).toHaveValue('secret plan');
  expect(await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).toEqual([]);
});

test('choosing with the keyboard from the composer starts where the page had focus', async ({
  context,
  extensionPage,
}) => {
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.getByRole('link', { name: 'Pricing' }).focus();
  await startCapture(extensionPage, pageUrl);
  await page.bringToFront();
  const card = await page.getByTestId('enterprise-card').boundingBox();
  if (card === null) throw new Error('fixture card is not rendered');
  await drawLassoAround(page, card);

  const composer = await composerOf(page);
  await composer.getByRole('button', { name: 'Вибрати з клавіатури' }).click();
  const probe = await OverlayProbe.attach(page);
  await expect.poll(() => probe.text('cursor')).toBe('Елемент: a');
});
