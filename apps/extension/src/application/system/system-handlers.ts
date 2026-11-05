import { ok, type Clock } from '@redline/core';
import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';

export interface SystemHandlerDeps {
  readonly clock: Clock;
  readonly version: string;
}

/** Whether the service worker answers, and which version it runs. */
export const createSystemHandlers = ({
  clock,
  version,
}: SystemHandlerDeps): Pick<ProtocolHandlers<AppProtocol>, 'system.ping'> => ({
  'system.ping': ({ nonce }) => Promise.resolve(ok({ nonce, version, receivedAt: clock.now() })),
});
