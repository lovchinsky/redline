import { EventSubscriber, RpcClient, events, protocol } from '@redline/rpc';
import { RuntimeClientTransport } from '../adapters/messaging/runtime-client-transport';
import { RuntimeEventSource } from '../adapters/messaging/runtime-events';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import type { UiServices } from '../ui/services';

/** Composition root for extension pages (side panel, options). */
export const createUiContainer = (scope: string): UiServices => {
  const logger = new ConsoleLogger(scope);
  return {
    rpc: new RpcClient(protocol, new RuntimeClientTransport(), uuidIdGenerator),
    events: new EventSubscriber(events, new RuntimeEventSource(), logger.child('events')),
    ids: uuidIdGenerator,
    clock: { now: () => Date.now() },
  };
};
