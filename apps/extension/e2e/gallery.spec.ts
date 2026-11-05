import { startMockReceiver } from '@redline/mock-receiver';
import type { Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureStep, composerOf, drawLassoAround, startCapture } from './capture-helpers';
import { SITE_ORIGIN, expect, launchExtension, openOptions, openSidePanel, test } from './fixtures';

/**
 * Screenshots of every UI surface in its main states, for design review. Not a test of
 * behaviour: runs only on request (`GALLERY=1 pnpm exec playwright test gallery`).
 */
test.skip(!process.env['GALLERY'], 'Set GALLERY=1 to render the UI gallery');

const OUT = path.resolve(import.meta.dirname, '../test-results/gallery');
const PANEL = { width: 400, height: 900 };

const shot = async (page: Page, name: string, fullPage = true) => {
  // Colours and sheets ease in; let them settle.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
};

test('UI gallery', async () => {
  test.setTimeout(180_000);
  const receiver = await startMockReceiver({ token: 'secret' });
  const profile = await mkdtemp(path.join(tmpdir(), 'redline-gallery-'));
  try {
    // Steps are captured at 1×: device scale emulation does not reach tabs.captureVisibleTab,
    // so emulated 2× pages would get screenshots of the wrong scale.
    let context = await launchExtension(profile, 'uk');
    let panel = await openSidePanel(context);
    await panel.setViewportSize(PANEL);
    await shot(panel, '01-panel-empty');

    const site = await context.newPage();
    await site.goto(`${SITE_ORIGIN}/pricing.html`);
    await captureStep(site, panel, {
      around: '[data-testid="plan-card"]',
      comment: 'Зроби картки тарифів однакової висоти, кнопки вирівняй по низу',
    });
    await captureStep(site, panel, {
      around: '[data-testid="enterprise-card"]',
      comment: 'Перейменуй Enterprise на Business',
    });

    await startCapture(panel, site.url());
    await site.bringToFront();
    const card = await site.getByTestId('enterprise-card').boundingBox();
    if (card === null) throw new Error('no card');
    await drawLassoAround(site, card);
    const composer = await composerOf(site);
    await expect(composer.getByTestId('comment')).toBeFocused();
    await site.keyboard.type('Зроби кнопку основним кольором');
    await shot(site, '02-overlay-composer');
    await context.close();

    // The UI itself at 2×, for people to look at; the draft survives the restart.
    context = await launchExtension(profile, 'uk', 2);
    panel = await openSidePanel(context);
    await panel.setViewportSize(PANEL);
    await expect(panel.getByTestId('step')).toHaveCount(2);
    await shot(panel, '03-panel-draft-no-receiver');
    await panel.emulateMedia({ colorScheme: 'dark' });
    await shot(panel, '03-panel-draft-dark');
    await panel.emulateMedia({ colorScheme: 'light' });

    await panel.getByTestId('assemble').click();
    await expect(panel.getByTestId('bundle-context')).toBeVisible();
    await shot(panel, '04-panel-preview', false);
    await panel.keyboard.press('Escape');

    const options = await openOptions(context);
    await options.setViewportSize({ width: 1100, height: 900 });
    await options.getByTestId('receiver-url').fill(receiver.url);
    await options.getByTestId('receiver-token').fill('secret');
    await options.getByTestId('receiver-save').click();
    await expect(options.getByTestId('receiver-feedback')).toBeVisible();
    await options.getByTestId('capture-record').first().locator('summary').click();
    await shot(options, '05-options');

    await panel.bringToFront();
    await panel.reload();
    await expect(panel.getByTestId('project-select')).toBeVisible();
    await panel.getByTestId('project-select').selectOption({ index: 1 });
    await shot(panel, '06-panel-ready-to-send');

    await panel.getByTestId('send').click();
    await expect(panel.getByTestId('empty-draft')).toBeVisible();
    await panel.getByTestId('tab-active').click();
    const task = panel.getByTestId('task');
    await expect
      .poll(
        async () => {
          await task.getByTestId('refresh').click();
          return task.getAttribute('data-phase');
        },
        { intervals: [1_100], timeout: 20_000 },
      )
      .toBe('needs-input');
    await shot(panel, '07-panel-task-question');
    await context.close();
  } finally {
    await receiver.close();
    await rm(profile, { recursive: true, force: true });
  }
});
