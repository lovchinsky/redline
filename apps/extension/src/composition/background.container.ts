import { FragmentCatalog, SerialRateLimiter } from '@redline/core';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { EventPublisher, RpcServer, events, protocol, type Unsubscribe } from '@redline/rpc';
import { browser, type Browser } from 'wxt/browser';
import { BadgeNotice } from '../adapters/capture/badge-notice';
import { scriptingInjector } from '../adapters/capture/scripting-injector';
import { RpcTabCaptureClient } from '../adapters/capture/tab-capture-client';
import { VisibleTabCapturer } from '../adapters/capture/visible-tab-capturer';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { IdbAssetStore } from '../adapters/idb/idb-asset-store';
import { IdbCaptureRepository } from '../adapters/idb/idb-capture-repository';
import { offscreenImageDeriver } from '../adapters/images/offscreen-image-deriver';
import { RuntimeEventSink } from '../adapters/messaging/runtime-events';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { CommitStep, DeriveImage, TakeSnapshot } from '../application/capture/capture-assets';
import { createCaptureHandlers } from '../application/capture/capture-handlers';
import { StartCapture } from '../application/capture/start-capture';
import { createSystemHandlers } from '../application/system/system-handlers';

/** `tabs.captureVisibleTab` allows two calls per second; keep a margin. */
const CAPTURE_INTERVAL_MS = 550;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Manifest command and context menu item that start capture on the current page. */
export const START_CAPTURE = 'start-capture';

/**
 * Composition root of the service worker: the only place that knows concrete adapters.
 * `start` attaches every listener synchronously, as MV3 requires for wake-up events.
 */
export const createBackgroundContainer = () => {
  const logger = new ConsoleLogger('background');
  const version = browser.runtime.getManifest().version;
  const publisher = new EventPublisher(events, new RuntimeEventSink(logger.child('events')));
  const notice = new BadgeNotice(logger.child('notice'));
  const database = new DatabaseConnection(() => openDatabase({ logger: logger.child('db') }));
  const assets = new IdbAssetStore(database, uuidIdGenerator, systemClock);

  const startCapture = new StartCapture({
    injector: scriptingInjector,
    tabs: new RpcTabCaptureClient(uuidIdGenerator),
    notice,
    logger: logger.child('capture'),
  });

  const server = new RpcServer(
    protocol,
    {
      ...createSystemHandlers({
        clock: systemClock,
        version,
        events: publisher,
        logger: logger.child('system'),
      }),
      ...createCaptureHandlers({
        startCapture,
        takeSnapshot: new TakeSnapshot(
          new VisibleTabCapturer(new SerialRateLimiter(CAPTURE_INTERVAL_MS, systemClock, sleep)),
          assets,
        ),
        deriveImage: new DeriveImage(offscreenImageDeriver, assets),
        commitStep: new CommitStep({
          catalog: new FragmentCatalog(fragmentDescriptors),
          repository: new IdbCaptureRepository(database),
          events: publisher,
          ids: uuidIdGenerator,
          clock: systemClock,
          logger: logger.child('steps'),
        }),
      }),
    },
    logger.child('rpc'),
  );

  /** User gestures (shortcut, context menu) grant activeTab for the tab they target. */
  const startCaptureFromGesture = (tab: Browser.tabs.Tab | undefined): void => {
    if (tab?.id === undefined) return;
    void startCapture.execute({ tabId: tab.id, url: tab.url });
  };

  return {
    start(): Unsubscribe {
      const stopServer = server.listen(new RuntimeServerTransport());

      const onCommand = (command: string, tab?: Browser.tabs.Tab) => {
        if (command === START_CAPTURE) startCaptureFromGesture(tab);
      };
      const onMenuClick = (info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) => {
        if (info.menuItemId === START_CAPTURE) startCaptureFromGesture(tab);
      };
      const onInstalled = () => {
        browser.contextMenus.create({
          id: START_CAPTURE,
          title: 'Обвести область (Redline)',
          contexts: ['page', 'selection', 'link', 'image'],
        });
      };
      // A notice explains why capture failed on one page; it should not outlive that page.
      const onTabUpdated = (tabId: number, change: Browser.tabs.OnUpdatedInfo) => {
        if (change.status === 'loading') void notice.clear(tabId);
      };

      browser.commands.onCommand.addListener(onCommand);
      browser.contextMenus.onClicked.addListener(onMenuClick);
      browser.runtime.onInstalled.addListener(onInstalled);
      browser.tabs.onUpdated.addListener(onTabUpdated);
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((cause: unknown) => {
          logger.error('Could not enable the side panel on action click', { cause: String(cause) });
        });
      logger.info('Service worker started', { version });

      return () => {
        stopServer();
        browser.commands.onCommand.removeListener(onCommand);
        browser.contextMenus.onClicked.removeListener(onMenuClick);
        browser.runtime.onInstalled.removeListener(onInstalled);
        browser.tabs.onUpdated.removeListener(onTabUpdated);
      };
    },
  };
};
