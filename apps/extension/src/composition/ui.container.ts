import { EventSubscriber, RpcClient, events, protocol } from '@redline/rpc';
import { ZipBundleArchiver } from '../adapters/archive/zip-bundle-archiver';
import { chromeMessages } from '../adapters/i18n/chrome-messages';
import { MessageTranslator } from '../adapters/i18n/message-translator';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { IdbLocalFiles } from '../adapters/idb/idb-local-files';
import { RuntimeClientTransport } from '../adapters/messaging/runtime-client-transport';
import { RuntimeEventSource } from '../adapters/messaging/runtime-events';
import { browserHostAccess, browserNavigation } from '../adapters/platform/ui-platform';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import type { UiServices } from '../ui/services';

/** Composition root for extension pages (side panel, options). */
export const createUiContainer = (scope: string): UiServices => {
  const logger = new ConsoleLogger(scope);
  return {
    rpc: new RpcClient(protocol, new RuntimeClientTransport(), uuidIdGenerator),
    events: new EventSubscriber(events, new RuntimeEventSource(), logger.child('events')),
    // Pages only read; the service worker remains the only writer.
    files: new IdbLocalFiles(
      new DatabaseConnection(() => openDatabase({ logger: logger.child('db') })),
    ),
    archiver: new ZipBundleArchiver(),
    hostAccess: browserHostAccess,
    navigation: browserNavigation,
    i18n: new MessageTranslator(chromeMessages),
    ids: uuidIdGenerator,
    clock: { now: () => Date.now() },
  };
};
