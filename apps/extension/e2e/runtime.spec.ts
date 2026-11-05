import type { Page, Worker } from '@playwright/test';
import { callRpc, captureStep } from './capture-helpers';
import { SITE_ORIGIN, expect, openSidePanel, serviceWorkerOf, test } from './fixtures';

const appUrl = `${SITE_ORIGIN}/vue-app.html`;

/** Captures the two plan cards of the Vue fixture and returns the assembled context.md. */
const captureAndPreview = async (page: Page, panel: Page): Promise<string> => {
  await captureStep(page, panel, {
    around: '[data-testid="vue-plan-card"]',
    comment: 'Prices are missing on the cards',
  });
  await panel.bringToFront();
  await expect(panel.getByTestId('step')).toHaveCount(1);
  await panel.getByTestId('assemble').click();
  const context = panel.getByTestId('bundle-context');
  await expect(context).toContainText('# Redline task');
  return (await context.textContent()) ?? '';
};

const registeredPageRuntime = (serviceWorker: Worker) =>
  serviceWorker.evaluate(async () =>
    (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.matches),
  );

test('an unbound site: components from the page, errors only from capture on', async ({
  context,
}) => {
  const panel = await openSidePanel(context);
  const page = await context.newPage();
  await page.goto(appUrl);

  const markdown = await captureAndPreview(page, panel);
  expect(markdown).toContain('**Components** rendering');
  expect(markdown).toContain('`PlanCard` ‹ `PlanGrid` ‹ `PricingPage`');
  expect(markdown).toMatch(/Vue 3\.\d+\.\d+/);
  // The page failed before capture started; the runtime was not there to see it.
  expect(markdown).not.toContain('**Runtime errors**');
  // The Resource Timing buffer covers the whole page, so the failed request is known anyway.
  expect(markdown).toContain(`500 \`${SITE_ORIGIN}/api/prices\` (fetch)`);
});

test('a bound site: the runtime starts with the page and sees its errors', async ({ context }) => {
  const panel = await openSidePanel(context);
  expect(
    await callRpc(panel, 'bindings.set', {
      pattern: SITE_ORIGIN,
      project: { id: 'acme-web', name: 'Acme Web' },
    }),
  ).toMatchObject({ result: { ok: true } });
  const serviceWorker = await serviceWorkerOf(context);
  await expect.poll(() => registeredPageRuntime(serviceWorker)).toEqual([[`${SITE_ORIGIN}/*`]]);

  const page = await context.newPage();
  await page.goto(appUrl);
  const markdown = await captureAndPreview(page, panel);
  expect(markdown).toContain('**Runtime errors** (since the page loaded');
  expect(markdown).toContain("Cannot read properties of undefined (reading 'amount')");
  expect(markdown).toContain('`PlanCard` ‹ `PlanGrid` ‹ `PricingPage`');

  await callRpc(panel, 'bindings.remove', { pattern: SITE_ORIGIN });
  await expect.poll(() => registeredPageRuntime(serviceWorker)).toEqual([]);
});
