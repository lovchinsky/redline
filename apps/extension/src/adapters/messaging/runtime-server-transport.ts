import type { CallerInfo, RequestHandler, ServerTransport, Unsubscribe } from '@redline/rpc';
import { browser, type Browser } from 'wxt/browser';

/**
 * Who sent a message, from what Chrome vouches for: the extension's own pages are on its
 * origin; anything else of ours runs as a content script in a tab's frame. Messages from
 * other extensions, or without a frame to answer to, have no caller and are ignored.
 */
const callerOf = (sender: Browser.runtime.MessageSender): CallerInfo | null => {
  if (sender.id !== browser.runtime.id || sender.url === undefined) return null;
  if (URL.parse(sender.url)?.origin === new URL(browser.runtime.getURL('/')).origin) {
    return { kind: 'extension' };
  }
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === undefined) return null;
  return { kind: 'content-script', tabId, frameId: sender.frameId, url: sender.url };
};

/**
 * Serves RPC requests from `runtime.onMessage`, in the service worker and in content scripts.
 * Must be attached synchronously during start-up so wake-up messages are not lost.
 */
export class RuntimeServerTransport implements ServerTransport {
  listen(handler: RequestHandler): Unsubscribe {
    const listener = (
      message: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ): boolean => {
      const caller = callerOf(sender);
      if (caller === null) return false;
      const reply = handler(message, caller);
      if (reply === undefined) return false;
      void reply.then(sendResponse);
      return true; // keeps the channel open for the asynchronous response
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      browser.runtime.onMessage.removeListener(listener);
    };
  }
}
