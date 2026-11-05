import type { CaptureUnavailableReason, Logger } from '@redline/core';
import { browser } from 'wxt/browser';
import type { CaptureUnavailableNotice } from '../../ports/capture';
import type { MessageKey, Translator } from '../../ports/i18n';

const MESSAGES: Readonly<Record<CaptureUnavailableReason, MessageKey>> = {
  'browser-page': 'unavailableBrowserPage',
  'web-store': 'unavailableWebStore',
  'unsupported-scheme': 'unavailableScheme',
  'no-access': 'unavailableNoAccess',
};

/** Marks the toolbar icon of a tab with ✕ and explains the reason in its tooltip. */
export class BadgeNotice implements CaptureUnavailableNotice {
  constructor(
    private readonly i18n: Translator,
    private readonly logger: Logger,
  ) {}

  async show(tabId: number, reason: CaptureUnavailableReason): Promise<void> {
    await this.apply('show', () =>
      Promise.all([
        browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' }),
        browser.action.setBadgeText({ tabId, text: '✕' }),
        browser.action.setTitle({ tabId, title: this.i18n.text(MESSAGES[reason]) }),
      ]),
    );
  }

  /**
   * Chrome drops tab-specific values itself when the tab navigates, so a notice never outlives
   * its page. This clears it sooner, when capture works on the tab after all: leaving `text` out
   * hands the badge back to the global count; the title has no such reset, so it takes the
   * global one.
   */
  async clear(tabId: number): Promise<void> {
    await this.apply('clear', async () => {
      const title = await browser.action.getTitle({});
      await Promise.all([
        browser.action.setBadgeText({ tabId }),
        browser.action.setTitle({ tabId, title }),
      ]);
    });
  }

  private async apply(operation: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (cause) {
      // The tab may have closed meanwhile; the notice is cosmetic, so log and move on.
      this.logger.debug('Badge update skipped', { operation, cause: String(cause) });
    }
  }
}
