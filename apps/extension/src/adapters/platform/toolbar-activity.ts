import type { Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { ActivityIndicator } from '../../ports/delivery';

const ACTIVE = '#4a5cf0';
const NEEDS_INPUT = '#e8710a';

/** The global toolbar badge: how many tasks are in flight, orange when the agent asks. */
export class ToolbarActivity implements ActivityIndicator {
  constructor(private readonly logger: Logger) {}

  async show({ active, needsInput }: { active: number; needsInput: number }): Promise<void> {
    try {
      await Promise.all([
        browser.action.setBadgeText({ text: active === 0 ? '' : String(active) }),
        browser.action.setBadgeBackgroundColor({ color: needsInput > 0 ? NEEDS_INPUT : ACTIVE }),
        browser.action.setTitle({
          title:
            needsInput > 0
              ? `Redline: агент чекає на відповідь (${String(needsInput)})`
              : active > 0
                ? `Redline: задач у роботі — ${String(active)}`
                : 'Redline',
        }),
      ]);
    } catch (cause) {
      this.logger.debug('Badge update skipped', { cause: String(cause) });
    }
  }
}
