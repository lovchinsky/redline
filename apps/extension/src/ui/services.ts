import type { Clock, IdGenerator } from '@redline/core';
import type { AppEvents, AppProtocol, EventSubscriber, RpcClient } from '@redline/rpc';
import type { LocalFiles } from '../ports/drafts';

/** Everything UI code may use. Provided by a composition root; UI never touches adapters. */
export interface UiServices {
  readonly rpc: RpcClient<AppProtocol>;
  readonly events: EventSubscriber<AppEvents>;
  /** Images and bundle files, read locally; binary data never travels over messaging. */
  readonly files: LocalFiles;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}
