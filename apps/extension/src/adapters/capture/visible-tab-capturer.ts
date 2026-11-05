import { appError, err, ok, toAppError, type SerialRateLimiter } from '@redline/core';
import { browser } from 'wxt/browser';
import type { ViewportCapturer } from '../../ports/capture';

/**
 * Screenshots a tab's viewport with `tabs.captureVisibleTab`. Chrome limits how often it may
 * be called, so every call goes through a shared rate limiter.
 */
export class VisibleTabCapturer implements ViewportCapturer {
  constructor(private readonly limiter: SerialRateLimiter) {}

  async capture(tabId: number) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.active)
        return err(appError('validation', 'Only the visible tab can be captured', { tabId }));
      const dataUrl = await this.limiter.run(() =>
        browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
      );
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      bitmap.close();
      return ok({ blob, width, height });
    } catch (cause) {
      return err(
        appError('permission-denied', 'The tab could not be captured', {
          tabId,
          cause: toAppError(cause).message,
        }),
      );
    }
  }
}
