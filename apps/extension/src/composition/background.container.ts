import { EventPublisher, RpcServer, events, protocol, type Unsubscribe } from '@redline/rpc';
import { browser } from 'wxt/browser';
import { RuntimeEventSink } from '../adapters/messaging/runtime-events';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { createSystemHandlers } from '../application/system/system-handlers';

/**
 * Composition root of the service worker: the only place that knows concrete adapters.
 * `start` attaches every listener synchronously, as MV3 requires for wake-up events.
 */
export const createBackgroundContainer = () => {
  const logger = new ConsoleLogger('background');
  const version = browser.runtime.getManifest().version;
  const publisher = new EventPublisher(events, new RuntimeEventSink(logger.child('events')));

  const server = new RpcServer(
    protocol,
    {
      ...createSystemHandlers({
        clock: systemClock,
        version,
        events: publisher,
        logger: logger.child('system'),
      }),
    },
    logger.child('rpc'),
  );

  return {
    start(): Unsubscribe {
      const stopServer = server.listen(new RuntimeServerTransport());
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((cause: unknown) => {
          logger.error('Could not enable the side panel on action click', { cause: String(cause) });
        });
      logger.info('Service worker started', { version });
      return stopServer;
    },
  };
};
