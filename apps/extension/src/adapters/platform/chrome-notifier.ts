import type { Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { Notifier, TaskNotice } from '../../ports/delivery';
import type { Translator } from '../../ports/i18n';

/** Notification ids carry the task id, so a click can be traced back to its task. */
export const NOTIFICATION_PREFIX = 'task:';

const messageOf = (t: Translator, notice: TaskNotice): string => {
  switch (notice.kind) {
    case 'needs-input':
      return t.text('noticeNeedsInput', notice.question);
    case 'result-ready':
      return t.text('noticeResultReady');
    case 'remote-failed':
      return t.text('noticeRemoteFailed', notice.reason);
    case 'delivery-failed':
      return t.text('noticeDeliveryFailed', notice.reason);
  }
};

export class ChromeNotifier implements Notifier {
  constructor(
    private readonly iconUrl: string,
    private readonly i18n: Translator,
    private readonly logger: Logger,
  ) {}

  async notify(notice: TaskNotice): Promise<void> {
    try {
      await browser.notifications.create(`${NOTIFICATION_PREFIX}${notice.taskId}`, {
        type: 'basic',
        iconUrl: this.iconUrl,
        title: notice.taskTitle,
        message: messageOf(this.i18n, notice),
        priority: notice.kind === 'needs-input' ? 2 : 1,
      });
    } catch (cause) {
      this.logger.warn('Could not show a notification', { cause: String(cause) });
    }
  }
}
