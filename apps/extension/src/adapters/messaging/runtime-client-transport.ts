import { appError, err, ok, toAppError } from '@redline/core';
import type { ClientTransport } from '@redline/rpc';
import { browser } from 'wxt/browser';

/** Sends RPC requests to the service worker over `runtime.sendMessage`. */
export class RuntimeClientTransport implements ClientTransport {
  async send(request: Parameters<ClientTransport['send']>[0]) {
    try {
      const reply: unknown = await browser.runtime.sendMessage(request);
      return ok(reply);
    } catch (cause) {
      return err(
        appError('transport', 'Service worker is unreachable', {
          cause: toAppError(cause).message,
        }),
      );
    }
  }
}
