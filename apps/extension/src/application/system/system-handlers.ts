import { ok, type Clock, type Logger } from '@redline/core';
import type { AppEvents, AppProtocol, EventPublisher, ProtocolHandlers } from '@redline/rpc';

export interface SystemHandlerDeps {
  readonly clock: Clock;
  readonly version: string;
  readonly events: EventPublisher<AppEvents>;
  readonly logger: Logger;
}

export const createSystemHandlers = ({
  clock,
  version,
  events,
  logger,
}: SystemHandlerDeps): Pick<ProtocolHandlers<AppProtocol>, 'system.ping'> => ({
  'system.ping': ({ nonce }) => {
    const receivedAt = clock.now();
    const published = events.publish('system.pinged', { nonce, at: receivedAt });
    if (!published.ok) logger.error('Could not publish system.pinged', { ...published.error });
    return Promise.resolve(ok({ nonce, version, receivedAt }));
  },
});
