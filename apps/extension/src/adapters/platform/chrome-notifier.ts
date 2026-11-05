import type { Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { Notifier, TaskNotice } from '../../ports/delivery';

/** Notification ids carry the task id, so a click can be traced back to its task. */
export const NOTIFICATION_PREFIX = 'task:';

const messageOf = (notice: TaskNotice): string => {
  switch (notice.kind) {
    case 'needs-input':
      return `Агент питає: ${notice.question}`;
    case 'result-ready':
      return 'Результат готовий — натисніть, щоб відкрити';
    case 'remote-failed':
      return `Агент не впорався: ${notice.reason}`;
    case 'delivery-failed':
      return `Отримувач не прийняв задачу: ${notice.reason}`;
  }
};

export class ChromeNotifier implements Notifier {
  constructor(
    private readonly iconUrl: string,
    private readonly logger: Logger,
  ) {}

  async notify(notice: TaskNotice): Promise<void> {
    try {
      await browser.notifications.create(`${NOTIFICATION_PREFIX}${notice.taskId}`, {
        type: 'basic',
        iconUrl: this.iconUrl,
        title: notice.taskTitle,
        message: messageOf(notice),
        priority: notice.kind === 'needs-input' ? 2 : 1,
      });
    } catch (cause) {
      this.logger.warn('Could not show a notification', { cause: String(cause) });
    }
  }
}
