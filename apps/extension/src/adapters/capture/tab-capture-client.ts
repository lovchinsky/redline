import type { IdGenerator } from '@redline/core';
import { RpcClient, tabProtocol } from '@redline/rpc';
import type { TabCaptureClient } from '../../ports/capture';
import { TabClientTransport } from '../messaging/tab-client-transport';

export class RpcTabCaptureClient implements TabCaptureClient {
  constructor(private readonly ids: IdGenerator) {}

  start(tabId: number) {
    return new RpcClient(tabProtocol, new TabClientTransport(tabId), this.ids).call(
      'capture.start',
      {},
    );
  }
}
