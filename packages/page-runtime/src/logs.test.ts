import { describe, expect, it } from 'vitest';
import { ErrorLog } from './error-log';
import { NetworkLog } from './network';

/** A window stand-in: real event dispatch, without the test runner's global error handlers. */
const fakeWindow = (entries: PerformanceEntry[] = []) => {
  const target = new EventTarget();
  return Object.assign(target, {
    location: { href: 'https://app.acme.io/orders' },
    performance: { getEntriesByType: () => entries },
  }) as unknown as Window;
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

describe('NetworkLog', () => {
  it('reports HTTP errors from resource timing and resources that failed to load', () => {
    const entries = [
      {
        name: 'https://api.acme.io/orders?token=secret',
        responseStatus: 500,
        initiatorType: 'fetch',
        responseEnd: 50,
      },
      {
        name: 'https://app.acme.io/logo.png',
        responseStatus: 200,
        initiatorType: 'img',
        responseEnd: 60,
      },
    ].map((fields) => {
      const entry = Object.create(PerformanceResourceTiming.prototype) as PerformanceResourceTiming;
      for (const [key, value] of Object.entries(fields)) {
        Object.defineProperty(entry, key, { value });
      }
      return entry;
    });
    const view = fakeWindow(entries);
    const log = new NetworkLog(view, () => 100);
    const image = document.createElement('img');
    image.setAttribute('src', '/missing.png?x=1');
    const failed = new Event('error');
    Object.defineProperty(failed, 'target', { value: image });
    view.dispatchEvent(failed);

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
});
