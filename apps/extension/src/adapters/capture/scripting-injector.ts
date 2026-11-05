import { appError, err, okVoid, toAppError } from '@redline/core';
import { browser } from 'wxt/browser';
import type { CaptureScriptInjector } from '../../ports/capture';

export const CAPTURE_SCRIPT = '/content-scripts/capture.js';

/** Injects the capture content script into the top frame via the scripting API. */
export const scriptingInjector: CaptureScriptInjector = {
  async inject(tabId) {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: [CAPTURE_SCRIPT] });
      return okVoid();
    } catch (cause) {
      return err(
        appError('permission-denied', 'The extension cannot access this tab', {
          tabId,
          cause: toAppError(cause).message,
        }),
      );
    }
  },
};
