import type { Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { WakeUpReason, WakeUps } from '../../ports/delivery';

/** Alarm names; the composition root routes each alarm back to its use case. */
export const WAKE_UP_ALARMS: Readonly<Record<WakeUpReason, string>> = {
  deliver: 'wake-up:deliver',
  'check-statuses': 'wake-up:check-statuses',
};

/**
 * One alarm per reason, rescheduled to the earliest moment there is work. Alarms survive the
 * service worker being stopped, unlike timers. Chrome may delay them to its own minimum.
 */
export class AlarmWakeUps implements WakeUps {
  constructor(private readonly logger: Logger) {}

  async schedule(reason: WakeUpReason, time: number | null): Promise<void> {
    const name = WAKE_UP_ALARMS[reason];
    try {
      if (time === null) await browser.alarms.clear(name);
      else await browser.alarms.create(name, { when: time });
    } catch (cause) {
      this.logger.error('Could not schedule a wake-up', { reason, cause: String(cause) });
    }
  }
}
