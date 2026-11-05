import { appError, err, ok, toAppError } from '@redline/core';
import type { ClientTransport } from '@redline/rpc';
import { browser } from 'wxt/browser';

/** Sends RPC requests to the content script in the top frame of one tab. */
export class TabClientTransport implements ClientTransport {
  constructor(private readonly tabId: number) {}

  async send(request: Parameters<ClientTransport['send']>[0]) {
    try {
      const reply: unknown = await browser.tabs.sendMessage(this.tabId, request, { frameId: 0 });
      return ok(reply);
    } catch (cause) {
      return err(
        appError('transport', 'Content script in the tab is unreachable', {
          tabId: this.tabId,
          cause: toAppError(cause).message,
        }),
      );
    }
  }
}
