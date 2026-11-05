import { describe, expect, it } from 'vitest';
import { captureAvailability } from './capture-policy';

describe('captureAvailability', () => {
  it.each(['https://acme.io/pricing', 'http://localhost:3000/', 'file:///tmp/page.html'])(
    'allows %s',
    (url) => {
      expect(captureAvailability(url)).toEqual({ capturable: true });
    },
  );

  it.each([
    ['chrome://settings', 'browser-page'],
    ['chrome-extension://abc/page.html', 'browser-page'],
    ['about:blank', 'browser-page'],
    ['view-source:https://acme.io', 'browser-page'],
    ['https://chromewebstore.google.com/detail/x', 'web-store'],
    ['https://chrome.google.com/webstore/category/extensions', 'web-store'],
    ['data:text/html,hi', 'unsupported-scheme'],
    ['not a url', 'unsupported-scheme'],
  ])('rejects %s as %s', (url, reason) => {
    expect(captureAvailability(url)).toEqual({ capturable: false, reason });
  });
});
