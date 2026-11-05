import type { CallerInfo, RequestHandler, ServerTransport, Unsubscribe } from '@redline/rpc';
import { browser, type Browser } from 'wxt/browser';

const toCallerInfo = (sender: Browser.runtime.MessageSender): CallerInfo => ({
  ...(sender.tab?.id === undefined ? {} : { tabId: sender.tab.id }),
  ...(sender.frameId === undefined ? {} : { frameId: sender.frameId }),
  ...(sender.url === undefined ? {} : { url: sender.url }),
});

/**
 * Serves RPC requests from `runtime.onMessage` in the service worker.
 * Must be attached synchronously during worker start-up so wake-up messages are not lost.
 */
export class RuntimeServerTransport implements ServerTransport {
  listen(handler: RequestHandler): Unsubscribe {
    const listener = (
      message: unknown,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response: unknown) => void,
    ): boolean => {
      const reply = handler(message, toCallerInfo(sender));
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
