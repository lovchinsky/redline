import type { Clock, IdGenerator } from '@redline/core';
import type { AppEvents, AppProtocol, EventSubscriber, RpcClient } from '@redline/rpc';

/** Everything UI code may use. Provided by a composition root; UI never touches adapters. */
export interface UiServices {
  readonly rpc: RpcClient<AppProtocol>;
  readonly events: EventSubscriber<AppEvents>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}
