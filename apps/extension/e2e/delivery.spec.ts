import AxeBuilder from '@axe-core/playwright';
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
  await expect(task(panel).getByTestId('task-meta')).toContainText('Acme Web · 1 ');
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

test('a sent task opens with everything it asked for, in progress and in history', async ({
  context,
}) => {
  await configureReceiver(context);
  const panel = await openSidePanel(context);
  const site = await context.newPage();
  await site.goto(`${SITE_ORIGIN}/pricing.html`);
  await captureStep(site, panel, {
    around: '[data-testid="plan-card"]',
    comment: 'Make the cards equal height',
  });
  await captureStep(site, panel, {
    around: '[data-testid="enterprise-card"]',
    comment: 'Rename Enterprise to Business',
  });
  await site.close();
  await panel.bringToFront();
  await expect(panel.getByTestId('step')).toHaveCount(2);
  await panel.getByTestId('project-select').selectOption({ label: 'Acme Web' });
  await panel.getByTestId('send').click();
  await expect(panel.getByTestId('empty-draft')).toBeVisible();

  // In progress: the card shows the first comment; its sheet shows every step with its picture.
  await panel.getByTestId('tab-active').click();
  const openTask = task(panel).getByRole('button', { name: 'Відкрити задачу' });
  await openTask.click();
  const sheet = panel.getByTestId('task-sheet');
  await expect(sheet.getByTestId('task-state')).toBeVisible();
  await expect(sheet.getByTestId('step-comment')).toHaveText([
    'Make the cards equal height',
    'Rename Enterprise to Business',
  ]);
  await expect(sheet.locator('img.step-shot')).toHaveCount(2);

  // What the agent got is one click further, read from the same frozen bundle.
  await sheet.getByTestId('task-bundle').locator('summary').click();
  await expect(sheet.getByTestId('bundle-context')).toContainText('Rename Enterprise to Business');
  const { violations } = await new AxeBuilder({ page: panel })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(violations.map(({ id }) => id)).toEqual([]);

  // A modal sheet: Escape closes it and focus goes back to the task it was opened from.
  await panel.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(openTask).toBeFocused();

  // The title opens it too.
  await task(panel).getByTestId('task-open').click();
  await expect(sheet).toBeVisible();
  await panel.keyboard.press('Escape');

  // The agent's question is answered from the sheet, with the steps in view.
  await expect
    .poll(
      async () => {
        await task(panel).getByTestId('refresh').click();
        return task(panel).getAttribute('data-phase');
      },
      { intervals: [1_100] },
    )
    .toBe('needs-input');
  await task(panel).getByTestId('task-open').click();
  await sheet.getByRole('button', { name: 'Desktop only' }).click();
  await expect(sheet.getByTestId('question')).toHaveCount(0);
  await panel.keyboard.press('Escape');

  // Finished, the task opens from History just the same.
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
  await task(panel).getByTestId('task-open').click();
  await expect(sheet.getByTestId('step-comment')).toHaveCount(2);
  await expect(sheet.getByRole('button', { name: 'Відкрити результат' })).toBeVisible();
});

test('offline while sending: nothing is lost, nothing is sent twice', async ({ context }) => {
  await configureReceiver(context);
  const panel = await openSidePanel(context);
  await draftOneStep(context, panel, 'Fix the cards');

  receiver.fail('unavailable', { on: 'submitTask' });
  await panel.getByTestId('project-select').selectOption({ label: 'Acme Web' });
  await panel.getByTestId('send').click();
  await panel.getByTestId('tab-active').click();
  await expect(task(panel)).toHaveAttribute('data-attempts', '1');
  await expect(task(panel).getByTestId('task-state')).toContainText('Повтор о');
  expect(receiver.tasks.size).toBe(0);

  // The receiver comes back but loses its answer after accepting: the extension cannot tell.
  receiver.fail('drop-after-accept', { on: 'submitTask' });
  await task(panel).getByRole('button', { name: 'Спробувати зараз' }).click();
  // The attempt is counted before it is made, so the receiver's side is awaited on its own.
  await expect(task(panel)).toHaveAttribute('data-attempts', '2');
  await expect.poll(() => receiver.tasks.size).toBe(1);

  await task(panel).getByRole('button', { name: 'Спробувати зараз' }).click();
  await expect(task(panel)).toHaveAttribute('data-state', 'with-agent');
  expect(receiver.submissions()).toBe(3);
  expect(receiver.tasks.size).toBe(1);
});
