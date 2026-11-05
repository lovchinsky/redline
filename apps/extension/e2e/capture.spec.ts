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

  const [task] = await readStore<StoredTask>(serviceWorker, 'drafts');
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
  await page.keyboard.press('Escape'); // drops the shape, back to armed
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

test('a page that re-renders while the user types still gives the context of what is on screen', async ({
  context,
  extensionPage,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.bringToFront();
  await startCapture(extensionPage, pageUrl);

  const card = await page.getByTestId('plan-card').nth(1).boundingBox();
  if (card === null) throw new Error('fixture cards are not rendered');
  await drawLassoAround(page, card);
  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'article[data-testid=plan-card]',
  );

  // A framework re-render: every card is replaced by an identical new node.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-testid=plan-card]')) {
      element.replaceWith(element.cloneNode(true));
    }
  });
  await composer.getByTestId('comment').fill('Tighten the spacing');
  await composer.getByTestId('submit').click();
  await expect(page.locator('redline-overlay')).toHaveCount(0);

  await expect
    .poll(async () => (await readStore<StoredTask>(serviceWorker, 'drafts')).length)
    .toBe(1);
  const [task] = await readStore<StoredTask>(serviceWorker, 'drafts');
  const stored = (await readStore<StoredCapture & { id: string }>(serviceWorker, 'captures')).find(
    (record) => record.id === task?.steps[0]?.captureId,
  );
  const styles = stored?.capture.fragments.find((f) => f.kind === 'computed-styles')?.data as
    { elements: { styles: Record<string, string> }[] } | undefined;
  // Read from the live card: a detached one has no computed styles at all.
  expect(Object.keys(styles?.elements[0]?.styles ?? {}).length).toBeGreaterThan(0);
});

test('circling inside a modal dialog the page opened', async ({ context, extensionPage }) => {
  const page = await context.newPage();
  await page.goto(pageUrl);
  // A modal makes everything outside it inert, an overlay on top of the page included.
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML =
      '<p>Upgrade your plan?</p><button data-testid="confirm-upgrade">Upgrade</button>';
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.bringToFront();
  await startCapture(extensionPage, pageUrl);

  const button = await page.getByTestId('confirm-upgrade').boundingBox();
  if (button === null) throw new Error('the dialog is not rendered');
  await drawLassoAround(page, button);
  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'button[data-testid=confirm-upgrade]',
  );
});

test('shapes drawn at different scroll positions each enclose what was under them', async ({
  context,
  extensionPage,
  serviceWorker,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto(pageUrl);
  // Room to scroll below the cards.
  await page.evaluate(() => {
    document.body.append(Object.assign(document.createElement('div'), { style: 'height:1500px' }));
  });
  await page.bringToFront();
  await startCapture(extensionPage, pageUrl);

  const first = await page.getByTestId('plan-card').nth(0).boundingBox();
  if (first === null) throw new Error('fixture cards are not rendered');
  await drawLassoAround(page, first);
  const composer = await composerOf(page);
  await expect(composer.getByTestId('shape-summaries')).toHaveText(
    'article[data-testid=plan-card]',
  );

  await page.evaluate(() => {
    window.scrollBy(0, 150);
  });
  const enterprise = await page.getByTestId('enterprise-card').boundingBox();
  if (enterprise === null) throw new Error('fixture card is not rendered');
  await drawLassoAround(page, enterprise);
  await expect(composer.getByTestId('shape-summaries')).toContainText('enterprise-card');

  await composer.getByTestId('comment').fill('Same padding everywhere');
  await composer.getByTestId('submit').click();
  await expect(page.locator('redline-overlay')).toHaveCount(0);
  await expect
    .poll(async () => (await readStore<StoredTask>(serviceWorker, 'drafts')).length)
    .toBe(1);
  const [task] = await readStore<StoredTask>(serviceWorker, 'drafts');
  const stored = (await readStore<StoredCapture & { id: string }>(serviceWorker, 'captures')).find(
    (record) => record.id === task?.steps[0]?.captureId,
  );
  // Each area got its own screenshot, taken at the scroll it was drawn at.
  expect(stored?.capture.fragments.filter((f) => f.kind === 'screenshot')).toHaveLength(2);
});
