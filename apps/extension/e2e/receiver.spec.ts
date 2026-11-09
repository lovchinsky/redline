import type { Page } from '@playwright/test';
import { captureStep } from './capture-helpers';
import { SITE_ORIGIN, expect, openOptions, openSidePanel, test } from './fixtures';
import { startReceiver, type RunningReceiver } from './receiver';

let receiver: RunningReceiver;
test.beforeAll(async () => {
  receiver = await startReceiver();
});
test.afterAll(async () => {
  await receiver.stop();
});

const task = (panel: Page) => panel.getByTestId('task');

/** Refreshes the task until it reaches `phase`; the receiver allows a check every second. */
const reach = async (panel: Page, phase: string) => {
  await expect
    .poll(
      async () => {
        if ((await task(panel).count()) === 0) return 'gone';
        await task(panel).getByTestId('refresh').click();
        return task(panel).getAttribute('data-phase');
      },
      { intervals: [1_100], timeout: 30_000 },
    )
    .toBe(phase);
};

test('the real receiver: send, answer the agent, open the result', async ({ context }) => {
  test.setTimeout(90_000);
  const options = await openOptions(context);
  await options.getByTestId('receiver-url').fill(receiver.url);
  await options.getByTestId('receiver-token').fill(receiver.token);
  await options.getByTestId('receiver-save').click();
  await expect(options.getByTestId('receiver-feedback')).toHaveText(
    'Отримувач на зв’язку, проєктів: 1',
  );
  await options.close();

  const panel = await openSidePanel(context);
  const page = await context.newPage();
  await page.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(page, panel, {
    around: '[data-testid="plan-card"]',
    comment: 'Make the cards equal height',
  });
  await page.close();
  await panel.bringToFront();

  await panel.getByTestId('project-select').selectOption({ label: 'Acme Web' });
  await panel.getByTestId('send').click();
  await panel.getByTestId('tab-active').click();
  await expect(task(panel)).toBeVisible();

  await reach(panel, 'needs-input');
  await expect(task(panel).getByTestId('question')).toHaveText(
    'Should the change apply to every breakpoint?',
  );
  await task(panel).getByRole('button', { name: 'Desktop only' }).click();

  await reach(panel, 'gone');
  await panel.getByTestId('tab-history').click();
  await expect(task(panel)).toHaveAttribute('data-phase', 'result-ready');
  await expect(task(panel).getByRole('button', { name: 'Відкрити результат' })).toBeVisible();
});
