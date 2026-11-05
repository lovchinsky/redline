import { startMockReceiver, type MockReceiver } from '@redline/mock-receiver';
import type { BrowserContext, Page } from '@playwright/test';
import { captureStep } from './capture-helpers';
import { SITE_ORIGIN, expect, openOptions, openSidePanel, test } from './fixtures';

let receiver: MockReceiver;
test.beforeEach(async () => {
  receiver = await startMockReceiver({ token: 'secret' });
});
test.afterEach(async () => {
  await receiver.close();
});

/** Configures the receiver the way a user does: on the options page. */
const configureReceiver = async (context: BrowserContext) => {
  const options = await openOptions(context);
  await options.getByTestId('receiver-url').fill(receiver.url);
  await options.getByTestId('receiver-token').fill('secret');
  await options.getByTestId('receiver-save').click();
  await expect(options.getByTestId('receiver-feedback')).toHaveText(
    'Отримувач на зв’язку, проєктів: 1',
  );
  await options.close();
};

const draftOneStep = async (context: BrowserContext, panel: Page, comment: string) => {
  const page = await context.newPage();
  await page.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(page, panel, {
    around: '[data-testid="plan-card"]',
    intent: 'layout',
    comment,
  });
  // One tab per page URL: capture finds its tab by URL.
  await page.close();
  await panel.bringToFront();
  await expect(panel.getByTestId('step')).toHaveCount(1);
};

const task = (panel: Page) => panel.getByTestId('task');

test('from lasso to result: send, answer the agent, open the result', async ({ context }) => {
  await configureReceiver(context);
  const panel = await openSidePanel(context);
  await draftOneStep(context, panel, 'Make the cards equal height');

  await panel.getByTestId('project-select').selectOption({ label: 'Acme Web' });
  await expect(panel.getByText('Сайт https://redline.test запам’ятається')).toBeVisible();
  await panel.getByTestId('send').click();

  // The draft is gone; the task is in progress on the receiver.
  await expect(panel.getByTestId('empty-draft')).toBeVisible();
  await panel.getByTestId('tab-active').click();
  await expect(task(panel)).toHaveAttribute('data-phase', 'queued');
  expect(receiver.tasks.size).toBe(1);
  const [remote] = receiver.tasks.values();
  expect(remote?.files.get('context.md')?.toString()).toContain('Make the cards equal height');
  expect(remote?.projectId).toBe('acme-web');

  // The receiver allows a check every second; refresh until the agent asks.
  await expect
    .poll(
      async () => {
        await task(panel).getByTestId('refresh').click();
        return task(panel).getAttribute('data-phase');
      },
      { intervals: [1_100] },
    )
    .toBe('needs-input');
  await expect(task(panel).getByTestId('question')).toHaveText(
    'Should the change apply to every breakpoint?',
  );
  await task(panel).getByRole('button', { name: 'Desktop only' }).click();
  await expect(task(panel)).toHaveAttribute('data-phase', 'working');
  expect(remote?.replies).toEqual([{ questionId: 'q1', text: 'Desktop only' }]);

  await expect
    .poll(
      async () => {
        if ((await task(panel).count()) > 0) await task(panel).getByTestId('refresh').click();
        return task(panel).count();
      },
      { intervals: [1_100] },
    )
    .toBe(0);
  await panel.getByTestId('tab-history').click();
  await expect(task(panel)).toHaveAttribute('data-phase', 'result-ready');
  await expect(task(panel).getByRole('button', { name: 'Відкрити результат' })).toBeVisible();

  // The site is remembered: the next draft from it goes to the same project without asking.
  await panel.getByTestId('tab-draft').click();
  await draftOneStep(context, panel, 'And the footer');
  await expect(panel.getByTestId('project-select')).toHaveCount(0);
  await expect(panel.getByTestId('send')).toHaveText('Надіслати в «Acme Web»');
});

test('offline while sending: nothing is lost, nothing is sent twice', async ({ context }) => {
  await configureReceiver(context);
  const panel = await openSidePanel(context);
  await draftOneStep(context, panel, 'Fix the cards');

  receiver.fail('unavailable');
  await panel.getByTestId('project-select').selectOption({ label: 'Acme Web' });
  await panel.getByTestId('send').click();
  await panel.getByTestId('tab-active').click();
  await expect(task(panel)).toHaveAttribute('data-attempts', '1');
  await expect(task(panel).getByTestId('task-state')).toContainText('Повтор о');
  expect(receiver.tasks.size).toBe(0);

  // The receiver comes back but loses its answer after accepting: the extension cannot tell.
  receiver.fail('drop-after-accept');
  await task(panel).getByRole('button', { name: 'Спробувати зараз' }).click();
  await expect(task(panel)).toHaveAttribute('data-attempts', '2');
  expect(receiver.tasks.size).toBe(1);

  await task(panel).getByRole('button', { name: 'Спробувати зараз' }).click();
  await expect(task(panel)).toHaveAttribute('data-state', 'submitted');
  expect(receiver.submissions()).toBe(3);
  expect(receiver.tasks.size).toBe(1);
});
