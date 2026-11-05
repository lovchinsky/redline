import { describe, expect, it } from 'vitest';
import { ErrorLog } from './error-log';
import { NetworkLog, type ObservedWindow } from './network';
import { LIMITS } from './protocol';

/**
 * A window stand-in: real event dispatch, without the test runner's global error handlers.
 * Its resource timing observer reports `entries` at once, as `buffered: true` does, and
 * `time()` reports more later. The timing buffer itself is empty, as a full one would be.
 */
const fakeWindow = (entries: PerformanceEntry[] = []) => {
  const target = new EventTarget();
  const observers: ((entries: PerformanceEntry[]) => void)[] = [];
  class FakeObserver {
    constructor(private readonly callback: (list: { getEntries(): PerformanceEntry[] }) => void) {}
    observe(): void {
      const deliver = (delivered: PerformanceEntry[]) => {
        this.callback({ getEntries: () => delivered });
      };
      observers.push(deliver);
      deliver(entries);
    }
  }
  const view = Object.assign(target, {
    location: { href: 'https://app.acme.io/orders' },
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: FakeObserver,
    PerformanceResourceTiming,
    Element,
  }) as unknown as ObservedWindow;
  return Object.assign(view, {
    time: (more: PerformanceEntry[]) => {
      for (const deliver of observers) deliver(more);
    },
  });
};

const timing = (fields: Record<string, unknown>): PerformanceResourceTiming => {
  const entry = Object.create(PerformanceResourceTiming.prototype) as PerformanceResourceTiming;
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(entry, key, { value });
  return entry;
};

const failedToLoad = (view: Window, src: string) => {
  const image = document.createElement('img');
  image.setAttribute('src', src);
  const failed = new Event('error');
  Object.defineProperty(failed, 'target', { value: image });
  view.dispatchEvent(failed);
};

describe('ErrorLog', () => {
  it('deduplicates uncaught errors and rejections, newest first, without query strings', () => {
    let now = 0;
    const view = fakeWindow();
    const log = new ErrorLog(view, () => now);
    const error = () =>
      new ErrorEvent('error', {
        message: 'TypeError: price is undefined',
        filename: 'https://app.acme.io/assets/app.js?v=abc',
        lineno: 10,
        colno: 5,
      });
    view.dispatchEvent(error());
    now = 100;
    view.dispatchEvent(error());
    now = 200;
    const rejection = new Event('unhandledrejection');
    Object.assign(rejection, { reason: new Error('Request failed') });
    view.dispatchEvent(rejection);
    now = 300;

    expect(log.report(5)).toEqual([
      {
        message: 'Unhandled rejection: Error: Request failed',
        source: null,
        count: 1,
        lastSeenMsAgo: 100,
      },
      {
        message: 'TypeError: price is undefined',
        source: 'https://app.acme.io/assets/app.js:10:5',
        count: 2,
        lastSeenMsAgo: 200,
      },
    ]);
  });
});

describe('limits', () => {
  it('trims what it reports to what the client accepts, so one long error loses nothing else', () => {
    const view = fakeWindow();
    const errors = new ErrorLog(view, () => 0);
    view.dispatchEvent(
      new ErrorEvent('error', {
        message: `TypeError: ${'x'.repeat(5_000)}`,
        filename: `https://app.acme.io/${'deep/'.repeat(300)}chunk.js`,
        lineno: 1,
        colno: 2,
      }),
    );
    const [error] = errors.report(LIMITS.errors);
    expect(error?.message).toHaveLength(LIMITS.message);
    expect(error?.source).toHaveLength(LIMITS.url);
  });
});

describe('NetworkLog', () => {
  it('reports HTTP errors from resource timing and resources that failed to load', () => {
    const view = fakeWindow([
      timing({
        name: 'https://api.acme.io/orders?token=secret',
        responseStatus: 500,
        initiatorType: 'fetch',
        responseEnd: 50,
      }),
      timing({
        name: 'https://app.acme.io/logo.png',
        responseStatus: 200,
        initiatorType: 'img',
        responseEnd: 60,
      }),
    ]);
    const log = new NetworkLog(view, () => 100);
    failedToLoad(view, '/missing.png?x=1');

    expect(log.report(10)).toEqual([
      {
        url: 'https://app.acme.io/missing.png',
        status: 0,
        initiator: 'img',
        count: 1,
        lastSeenMsAgo: 0,
      },
      {
        url: 'https://api.acme.io/orders',
        status: 500,
        initiator: 'fetch',
        count: 1,
        lastSeenMsAgo: 50,
      },
    ]);
  });

  it('reports an image answered 404 once, with its status', () => {
    const view = fakeWindow();
    const log = new NetworkLog(view, () => 100);
    failedToLoad(view, '/avatar.png');
    view.time([
      timing({
        name: 'https://app.acme.io/avatar.png',
        responseStatus: 404,
        initiatorType: 'img',
        responseEnd: 90,
      }),
    ]);
    expect(log.report(10)).toMatchObject([{ url: 'https://app.acme.io/avatar.png', status: 404 }]);
  });

  it('keeps observing after the timing buffer is full', () => {
    const view = fakeWindow();
    const log = new NetworkLog(view, () => 1_000);
    const many = Array.from({ length: 300 }, (_, i) =>
      timing({
        name: `https://app.acme.io/item/${String(i)}.json`,
        responseStatus: 200,
        initiatorType: 'fetch',
        responseEnd: i,
      }),
    );
    view.time([
      ...many,
      timing({
        name: 'https://api.acme.io/late',
        responseStatus: 503,
        initiatorType: 'fetch',
        responseEnd: 999,
      }),
    ]);
    expect(log.report(10)).toMatchObject([{ url: 'https://api.acme.io/late', status: 503 }]);
  });
});
