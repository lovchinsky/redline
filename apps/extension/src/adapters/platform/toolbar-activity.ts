import type { Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { ActivityIndicator } from '../../ports/delivery';
import type { Translator } from '../../ports/i18n';

const ACTIVE = '#4a5cf0';
const NEEDS_INPUT = '#e8710a';

/** The global toolbar badge: how many tasks are in flight, orange when the agent asks. */
export class ToolbarActivity implements ActivityIndicator {
  constructor(
    private readonly i18n: Translator,
    private readonly logger: Logger,
  ) {}

  async show({ active, needsInput }: { active: number; needsInput: number }): Promise<void> {
    try {
      await Promise.all([
        browser.action.setBadgeText({ text: active === 0 ? '' : String(active) }),
        browser.action.setBadgeBackgroundColor({ color: needsInput > 0 ? NEEDS_INPUT : ACTIVE }),
        browser.action.setTitle({
          title:
            needsInput > 0
              ? this.i18n.text('toolbarNeedsInput', this.i18n.number(needsInput))
              : active > 0
                ? this.i18n.text('toolbarActive', this.i18n.number(active))
                : this.i18n.text('extName'),
        }),
      ]);
    } catch (cause) {
      this.logger.debug('Badge update skipped', { cause: String(cause) });
    }
  }
}
