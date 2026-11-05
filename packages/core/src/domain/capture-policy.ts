import type { ErrorReason } from '../shared/errors';

/** Why the extension cannot draw on a page. Also the reason of the error that says so. */
export type CaptureUnavailableReason = Extract<
  ErrorReason,
  'browser-page' | 'web-store' | 'unsupported-scheme' | 'no-access'
>;

export type CaptureAvailability =
  | { readonly capturable: true }
  | { readonly capturable: false; readonly reason: CaptureUnavailableReason };

const SCRIPTABLE_SCHEMES = new Set(['http:', 'https:', 'file:']);

/** Extension galleries refuse scripting even with host permissions. */
const isWebStore = (url: URL): boolean =>
  url.hostname === 'chromewebstore.google.com' ||
  (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) ||
  (url.hostname === 'microsoftedge.microsoft.com' && url.pathname.startsWith('/addons'));

/** Decides from the URL alone whether capture can run; access rights are checked on injection. */
export const captureAvailability = (rawUrl: string): CaptureAvailability => {
  if (!URL.canParse(rawUrl)) return { capturable: false, reason: 'unsupported-scheme' };
  const url = new URL(rawUrl);
  if (!SCRIPTABLE_SCHEMES.has(url.protocol)) {
    return {
      capturable: false,
      reason:
        url.protocol === 'data:' || url.protocol === 'blob:'
          ? 'unsupported-scheme'
          : 'browser-page',
    };
  }
  if (isWebStore(url)) return { capturable: false, reason: 'web-store' };
  return { capturable: true };
};
