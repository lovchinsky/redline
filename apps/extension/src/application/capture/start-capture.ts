import {
  appError,
  captureAvailability,
  err,
  type AppError,
  type Logger,
  type Result,
} from '@redline/core';
import type { CaptureStartResponse } from '@redline/rpc';
import type {
  CaptureScriptInjector,
  CaptureUnavailableNotice,
  TabCaptureClient,
} from '../../ports/capture';

export interface StartCaptureInput {
  readonly tabId: number;
  /** Known when the trigger carries tab details (keyboard shortcut, context menu). */
  readonly url?: string | undefined;
}

export interface StartCaptureDeps {
  readonly injector: CaptureScriptInjector;
  readonly tabs: TabCaptureClient;
  readonly notice: CaptureUnavailableNotice;
  readonly logger: Logger;
}

/**
 * Starts drawing on a page. Asks the capture script already in the tab first and injects it
 * only when none answers, so a second shortcut press never restarts a session in progress.
 */
export class StartCapture {
  constructor(private readonly deps: StartCaptureDeps) {}

  async execute({
    tabId,
    url,
  }: StartCaptureInput): Promise<Result<CaptureStartResponse, AppError>> {
    const { injector, tabs, notice, logger } = this.deps;

    if (url !== undefined) {
      const availability = captureAvailability(url);
      if (!availability.capturable) {
        await notice.show(tabId, availability.reason);
        return err(
          appError('restricted-page', 'Capture is not available on this page', {
            reason: availability.reason,
          }),
        );
      }
    }

    const running = await tabs.start(tabId);
    if (running.ok || running.error.code !== 'transport') return this.settle(tabId, running);

    const injected = await injector.inject(tabId);
    if (!injected.ok) {
      logger.warn('Could not inject the capture script', { tabId, ...injected.error });
      await notice.show(tabId, 'no-access');
      return injected;
    }
    return this.settle(tabId, await tabs.start(tabId));
  }

  private async settle(
    tabId: number,
    result: Result<CaptureStartResponse, AppError>,
  ): Promise<Result<CaptureStartResponse, AppError>> {
    if (result.ok) await this.deps.notice.clear(tabId);
    else this.deps.logger.error('Capture script did not start', { tabId, ...result.error });
    return result;
  }
}
