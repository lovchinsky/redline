import { startMockReceiver, type MockReceiver } from '@redline/mock-receiver';
import type { Frame, Page } from '@playwright/test';
import { composerOf, drawLassoAround, startCapture } from './capture-helpers';
import { SITE_ORIGIN, expect, openOptions, openSidePanel, test } from './fixtures';

/** Names and words that cannot wrap, as real projects, URLs and comments have them. */
const PROJECT = 'goitacademy/lms-front-office-of-the-learning-management-system';
const LONG_URL = `${SITE_ORIGIN}/pricing.html?next=/uk/learn/${'a1b2c3d4e5'.repeat(8)}/training`;
const LONG_WORD = `https://lms.example/${'x'.repeat(120)}`;

/** A side panel as narrow as Chrome lets it be. */
const NARROW = { width: 360, height: 760 };
/** A narrow browser window: the options page opens in a tab of its own, never in the panel. */
const NARROW_TAB = { width: 500, height: 760 };

let receiver: MockReceiver;
test.beforeEach(async () => {
  receiver = await startMockReceiver({ token: 'secret', projects: [{ id: 'lms', name: PROJECT }] });
});
test.afterEach(async () => {
  await receiver.close();
});

/** What sticks out past the right edge of a document: nothing, when its layout holds. */
const overflowOf = (target: Page | Frame) =>
  target.evaluate(() => {
    const root = document.documentElement;
    const sticking = [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > root.clientWidth + 0.5)
      .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`);
    return {
      sideways: root.scrollWidth > root.clientWidth,
      downwards: root.scrollHeight > root.clientHeight,
      sticking,
    };
  });

const expectNoSidewaysScroll = async (target: Page | Frame, where: string) => {
  const overflow = await overflowOf(target);
  expect(overflow.sticking, `${where}: past the right edge`).toEqual([]);
  expect(overflow.sideways, `${where}: scrolls sideways`).toBe(false);
};

test('long names, URLs and wide screenshots fit a narrow side panel, options page and composer', async ({
  context,
}) => {
  const options = await openOptions(context);
  await options.setViewportSize(NARROW_TAB);
  await options.getByTestId('receiver-url').fill(receiver.url);
  await options.getByTestId('receiver-token').fill('secret');
  await options.getByTestId('receiver-save').click();
  await expect(options.getByTestId('receiver-feedback')).toContainText('1');

  const panel = await openSidePanel(context);
  await panel.setViewportSize(NARROW);

  // A step around the whole row of cards: a wide, low screenshot, on a page with a long URL.
  const page = await context.newPage();
  await page.goto(LONG_URL);
  await page.bringToFront();
  await startCapture(panel, page.url());
  await page.bringToFront();
  const cards = await page
    .locator('.card')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect),
    );
  const left = Math.min(...cards.map((card) => card.left));
  const top = Math.min(...cards.map((card) => card.top));
  await drawLassoAround(page, {
    x: left,
    y: top,
    width: Math.max(...cards.map((card) => card.right)) - left,
    height: Math.max(...cards.map((card) => card.bottom)) - top,
  });
  const composer = await composerOf(page);
  await composer.getByTestId('comment').click();
  await page.keyboard.type(`Replace the link ${LONG_WORD}`);
  // The frame is sized to the panel: it never scrolls, whatever is typed.
  const frame = await overflowOf(composer);
  expect(frame).toMatchObject({ sideways: false, downwards: false });
  await composer.getByTestId('submit').click();
  await expect(page.locator('redline-overlay')).toHaveCount(0);
  await page.close();

  await panel.bringToFront();
  await expect(panel.getByTestId('step')).toHaveCount(1);
  await panel.getByTestId('project-select').selectOption({ label: PROJECT });
  await expectNoSidewaysScroll(panel, 'draft');
  // One step fits the panel's height: nothing scrolls at all.
  expect((await overflowOf(panel)).downwards, 'draft: scrolls downwards').toBe(false);
  // The screenshot is scaled into its card, whole.
  const shot = await panel.locator('.step-shot').boundingBox();
  expect(shot?.width ?? 0).toBeLessThanOrEqual(NARROW.width);

  await panel.getByTestId('assemble').click();
  await expect(panel.getByTestId('bundle-digest')).toBeVisible();
  await expectNoSidewaysScroll(panel, 'preview');
  await panel.keyboard.press('Escape');
  await expect(panel.getByTestId('bundle-digest')).toBeHidden();

  await panel.getByTestId('send').click();
  await expect(panel.getByTestId('empty-draft')).toBeVisible();
  await panel.getByTestId('tab-active').click();
  await expect(panel.getByTestId('task')).toHaveCount(1);
  await expectNoSidewaysScroll(panel, 'in progress');
  await panel.getByTestId('tab-history').click();
  await expectNoSidewaysScroll(panel, 'history');

  // The site is now bound to the long-named project.
  await options.reload();
  await expect(options.getByTestId('binding')).toContainText(PROJECT);
  await expectNoSidewaysScroll(options, 'options');
});
