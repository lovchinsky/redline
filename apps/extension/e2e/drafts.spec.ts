import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { captureStep, readStore } from './capture-helpers';
import {
  SITE_ORIGIN,
  expect,
  launchExtension,
  openSidePanel,
  serviceWorkerOf,
  test,
} from './fixtures';

interface StoredBundle {
  taskId: string;
  digest: string;
  manifest: { files: { path: string; sha256: string }[] };
}

/** SHA-256 of every file of the stored bundle, recomputed from the stored bytes. */
const storedBundleHashes = (serviceWorker: Worker) =>
  serviceWorker.evaluate(
    () =>
      new Promise<Record<string, string>>((resolve, reject) => {
        const open = indexedDB.open('redline');
        open.onerror = () => {
          reject(new Error('cannot open database'));
        };
        open.onsuccess = () => {
          const request = open.result.transaction('bundles').objectStore('bundles').getAll();
          request.onsuccess = async () => {
            const [bundle] = request.result as { files: { path: string; data: Blob }[] }[];
            const hashes: Record<string, string> = {};
            for (const file of bundle?.files ?? []) {
              const digest = await crypto.subtle.digest('SHA-256', await file.data.arrayBuffer());
              hashes[file.path] = Array.from(new Uint8Array(digest), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join('');
            }
            resolve(hashes);
          };
        };
      }),
  );

const comments = (panel: Page) => panel.getByTestId('step-comment').allTextContents();

let profile: string;
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), 'redline-e2e-'));
});
test.afterEach(async () => {
  await rm(profile, { recursive: true, force: true });
});

test('a draft of three steps on two pages survives a browser restart', async () => {
  let context = await launchExtension(profile);
  let panel = await openSidePanel(context);
  await expect(panel.getByTestId('empty-draft')).toBeVisible();

  const pricing = await context.newPage();
  await pricing.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(pricing, panel, {
    around: '[data-testid="plan-card"]',
    comment: 'Make the cards equal height',
  });
  await captureStep(pricing, panel, {
    around: '[data-testid="enterprise-card"]',
    comment: 'Rename Enterprise to Business',
  });
  const orders = await context.newPage();
  await orders.goto(`${SITE_ORIGIN}/orders.html`);
  await captureStep(orders, panel, {
    around: '[data-testid="export"]',
    comment: 'Make Export the primary button',
  });

  // The panel follows the draft live, without a reload.
  await panel.bringToFront();
  await expect(panel.getByTestId('step')).toHaveCount(3);
  await context.close();

  context = await launchExtension(profile);
  panel = await openSidePanel(context);
  await expect(panel.getByTestId('step')).toHaveCount(3);
  expect(await comments(panel)).toEqual([
    'Make the cards equal height',
    'Rename Enterprise to Business',
    'Make Export the primary button',
  ]);
  await expect(panel.getByTestId('step').locator('img.thumb')).toHaveCount(3);
  await context.close();
});

test('editing a draft in the side panel, and a preview that is exactly what is stored', async ({
  context,
}) => {
  const panel = await openSidePanel(context);
  const pricing = await context.newPage();
  await pricing.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(pricing, panel, {
    around: '[data-testid="plan-card"]',
    comment: 'Make the cards equal height',
  });
  await captureStep(pricing, panel, {
    around: '[data-testid="enterprise-card"]',
    comment: 'Rename Enterprise',
  });

  await panel.bringToFront();
  const steps = panel.getByTestId('step');
  await expect(steps).toHaveCount(2);

  await steps.nth(1).getByRole('button', { name: 'Вище' }).click();
  await expect
    .poll(() => comments(panel))
    .toEqual(['Rename Enterprise', 'Make the cards equal height']);

  await steps.nth(0).getByRole('button', { name: 'Змінити' }).click();
  await steps
    .nth(0)
    .getByRole('textbox', { name: 'Коментар' })
    .fill('Rename Enterprise to Business');
  await steps.nth(0).getByRole('button', { name: 'Зберегти' }).click();
  await expect
    .poll(() => comments(panel))
    .toEqual(['Rename Enterprise to Business', 'Make the cards equal height']);

  await panel.getByTestId('assemble').click();
  const context_md = panel.getByTestId('bundle-context');
  // The reordered step comes first; headings carry no type of change any more.
  await expect(context_md).toContainText('## Step 1 > Rename Enterprise to Business');
  // Both steps are on one page: the second one points to the first instead of repeating it.
  await expect(context_md).toContainText('_Page: same as Step 1._');

  const digest = await panel.getByTestId('bundle-digest').getAttribute('data-digest');
  const serviceWorker = await serviceWorkerOf(context);
  const [stored] = await readStore<StoredBundle>(serviceWorker, 'bundles');
  expect(stored?.digest).toBe(digest);
  const recomputed = await storedBundleHashes(serviceWorker);
  expect(Object.fromEntries(stored?.manifest.files.map((f) => [f.path, f.sha256]) ?? [])).toEqual(
    recomputed,
  );

  // Assembling again without changes returns the same frozen bundle.
  await panel.getByTestId('assemble').click();
  await expect(panel.getByTestId('bundle-digest')).toHaveAttribute('data-digest', digest ?? '');

  // Removing a step makes the preview stale.
  await steps.nth(1).getByRole('button', { name: 'Видалити крок' }).click();
  await steps.nth(1).getByRole('button', { name: 'Видалити крок' }).click();
  await expect(steps).toHaveCount(1);
  await expect(panel.getByText('Чернетка змінилась — складіть пакет ще раз.')).toBeVisible();
});

test('new drafts collect new steps; deleting the active one clears it', async ({ context }) => {
  const panel = await openSidePanel(context);
  const pricing = await context.newPage();
  await pricing.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(pricing, panel, {
    around: '[data-testid="enterprise-card"]',
    comment: 'First',
  });

  await panel.bringToFront();
  await panel.getByTestId('new-draft').click();
  await expect(panel.getByTestId('empty-draft')).toBeVisible();
  await captureStep(pricing, panel, {
    around: '[data-testid="enterprise-card"]',
    comment: 'Second',
  });

  await panel.bringToFront();
  await expect.poll(() => comments(panel)).toEqual(['Second']);
  await expect(panel.getByTestId('draft-select').locator('option')).toHaveCount(2);

  await panel.getByRole('button', { name: 'Видалити чернетку' }).click();
  await panel.getByRole('button', { name: 'Так, видалити' }).click();
  await expect(panel.getByTestId('empty-draft')).toBeVisible();
  await expect(panel.getByTestId('draft-select').locator('option')).toHaveCount(2); // "—" + First

  await panel.getByTestId('draft-select').selectOption({ label: 'First · 1 крок' });
  await expect.poll(() => comments(panel)).toEqual(['First']);
});
