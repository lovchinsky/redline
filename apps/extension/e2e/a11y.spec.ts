import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { captureStep } from './capture-helpers';
import { SITE_ORIGIN, expect, openOptions, openSidePanel, test } from './fixtures';

/** WCAG 2.1 A and AA rules that apply to the page as rendered. */
const audit = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
};

test('side panel and options pass an automated accessibility audit', async ({
  context,
  extensionPage,
}) => {
  const site = await context.newPage();
  await site.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(site, extensionPage, {
    around: '[data-testid=enterprise-card]',
    comment: 'Rename Enterprise to Business',
  });

  const panel = await openSidePanel(context);
  await expect(panel.getByTestId('step')).toHaveCount(1);
  await panel.getByTestId('assemble').click();
  await expect(panel.getByTestId('bundle-context')).toBeVisible();
  expect(await audit(panel)).toEqual([]);

  // Tabs follow the WAI-ARIA pattern: arrows move between them.
  await panel.getByTestId('tab-draft').focus();
  await panel.keyboard.press('ArrowRight');
  await expect(panel.getByTestId('tab-active')).toBeFocused();
  await expect(panel.getByTestId('tab-active')).toHaveAttribute('aria-selected', 'true');
  expect(await audit(panel)).toEqual([]);

  const options = await openOptions(context);
  await expect(options.getByTestId('capture-record')).toHaveCount(1);
  await options.getByTestId('capture-record').locator('summary').click();
  expect(await audit(options)).toEqual([]);
});
