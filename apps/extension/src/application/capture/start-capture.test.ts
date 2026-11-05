import { appError, err, ok, okVoid, type Logger } from '@redline/core';
import { describe, expect, it, vi } from 'vitest';
import type {
  CaptureScriptInjector,
  CaptureUnavailableNotice,
  TabCaptureClient,
} from '../../ports/capture';
import { StartCapture } from './start-capture';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const notRunning = err(appError('transport', 'Content script in the tab is unreachable'));

const setup = (
  overrides: { inject?: CaptureScriptInjector['inject']; start?: TabCaptureClient['start'] } = {},
) => {
  const inject = vi.fn(overrides.inject ?? (() => Promise.resolve(okVoid())));
  const start = vi.fn<TabCaptureClient['start']>(
    overrides.start ?? (() => Promise.resolve(ok({ status: 'started' }))),
  );
  const show = vi.fn<CaptureUnavailableNotice['show']>(() => Promise.resolve());
  const clear = vi.fn<CaptureUnavailableNotice['clear']>(() => Promise.resolve());
  const useCase = new StartCapture({
    injector: { inject },
    tabs: { start },
    notice: { show, clear },
    logger: silentLogger,
  });
  return { useCase, inject, start, show, clear };
};

describe('StartCapture', () => {
  it('injects the capture script when none is running, then starts it', async () => {
    const { useCase, inject, start, clear } = setup({
      start: vi
        .fn<TabCaptureClient['start']>()
        .mockResolvedValueOnce(notRunning)
        .mockResolvedValueOnce(ok({ status: 'started' })),
    });

    const result = await useCase.execute({ tabId: 3, url: 'https://acme.io/pricing' });

    expect(result).toEqual(ok({ status: 'started' }));
    expect(inject).toHaveBeenCalledWith(3);
    expect(start).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledWith(3);
  });

  it('reuses a running capture script instead of injecting again', async () => {
    const { useCase, inject } = setup({
      start: () => Promise.resolve(ok({ status: 'already-active' })),
    });

    const result = await useCase.execute({ tabId: 3, url: 'https://acme.io/pricing' });

    expect(result).toEqual(ok({ status: 'already-active' }));
    expect(inject).not.toHaveBeenCalled();
  });

  it('refuses browser pages without touching the tab', async () => {
    const { useCase, inject, show } = setup();

    const result = await useCase.execute({ tabId: 3, url: 'chrome://settings' });

    expect(result.ok ? null : result.error.code).toBe('restricted-page');
    expect(inject).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(3, 'browser-page');
  });

  it('reports missing access when injection fails', async () => {
    const denied = appError('permission-denied', 'Cannot access this tab');
    const { useCase, start, show } = setup({
      inject: () => Promise.resolve(err(denied)),
      start: () => Promise.resolve(notRunning),
    });

    const result = await useCase.execute({ tabId: 3 });

    expect(result).toEqual(err(denied));
    expect(start).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(3, 'no-access');
  });
});
