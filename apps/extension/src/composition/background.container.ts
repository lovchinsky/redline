import { AssemblyEngine, MarkdownContextRenderer, Packager } from '@redline/assembly';
import { FragmentCatalog, SerialQueue, SerialRateLimiter } from '@redline/core';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { dedupeProcessor } from '@redline/processors';
import { summaryTokens } from '@redline/profiles';
import { EventPublisher, RpcServer, events, protocol, type Unsubscribe } from '@redline/rpc';
import { browser, type Browser } from 'wxt/browser';
import { BadgeNotice } from '../adapters/capture/badge-notice';
import { scriptingInjector } from '../adapters/capture/scripting-injector';
import { RpcTabCaptureClient } from '../adapters/capture/tab-capture-client';
import { VisibleTabCapturer } from '../adapters/capture/visible-tab-capturer';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { IdbAssetStore } from '../adapters/idb/idb-asset-store';
import { IdbActiveDraftStore } from '../adapters/idb/idb-active-draft-store';
import { IdbBundleRepository } from '../adapters/idb/idb-bundle-repository';
import { IdbCaptureRepository } from '../adapters/idb/idb-capture-repository';
import { IdbTaskRepository } from '../adapters/idb/idb-task-repository';
import { offscreenImageDeriver } from '../adapters/images/offscreen-image-deriver';
import { RuntimeEventSink } from '../adapters/messaging/runtime-events';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { DeriveImage, TakeSnapshot } from '../application/capture/capture-assets';
import { createCaptureHandlers } from '../application/capture/capture-handlers';
import { StartCapture } from '../application/capture/start-capture';
import { AssembleBundle } from '../application/drafts/assemble-bundle';
import { CollectGarbage } from '../application/drafts/collect-garbage';
import { CommitStep } from '../application/drafts/commit-step';
import {
  ActivateDraft,
  CreateDraft,
  DeleteDraft,
  EditDraft,
  RemoveStep,
} from '../application/drafts/draft-commands';
import { createDraftHandlers } from '../application/drafts/draft-handlers';
import { GetDraft, ListDrafts } from '../application/drafts/draft-queries';
import { DraftWriter } from '../application/drafts/draft-writer';
import { StoredCaptures } from '../application/drafts/stored-captures';
import { createSystemHandlers } from '../application/system/system-handlers';

/** `tabs.captureVisibleTab` allows two calls per second; keep a margin. */
const CAPTURE_INTERVAL_MS = 550;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Manifest command and context menu item that start capture on the current page. */
export const START_CAPTURE = 'start-capture';

/** Alarm that deletes unreferenced captures and images. */
const COLLECT_GARBAGE = 'collect-garbage';
const COLLECT_GARBAGE_PERIOD_MIN = 6 * 60;

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

  const catalog = new FragmentCatalog(fragmentDescriptors);
  const captureRepository = new IdbCaptureRepository(database);
  const tasks = new IdbTaskRepository(database);
  const active = new IdbActiveDraftStore(database);
  const bundles = new IdbBundleRepository(database);
  const writer = new DraftWriter({
    queue: new SerialQueue(),
    active,
    events: publisher,
    logger: logger.child('drafts'),
  });
  const captures = new StoredCaptures({
    repository: captureRepository,
    assets,
    catalog,
    logger: logger.child('captures'),
  });
  const commands = {
    tasks,
    active,
    bundles,
    captures,
    writer,
    ids: uuidIdGenerator,
    clock: systemClock,
  };
  const queries = { tasks, active, captures, catalog };
  const collectGarbage = new CollectGarbage({
    tasks,
    captures: captureRepository,
    assets,
    writer,
    clock: systemClock,
    logger: logger.child('gc'),
  });

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
          catalog,
          captures: captureRepository,
          tasks,
          active,
          writer,
          ids: uuidIdGenerator,
          clock: systemClock,
          logger: logger.child('steps'),
        }),
      }),
      ...createDraftHandlers({
        listDrafts: new ListDrafts(queries),
        getDraft: new GetDraft(queries),
        createDraft: new CreateDraft(commands),
        activateDraft: new ActivateDraft(commands),
        editDraft: new EditDraft(commands),
        removeStep: new RemoveStep(commands),
        deleteDraft: new DeleteDraft(commands),
        assembleBundle: new AssembleBundle({
          tasks,
          captures,
          bundles,
          engine: new AssemblyEngine({
            processors: [dedupeProcessor],
            renderer: new MarkdownContextRenderer(catalog, {
              budget: { summaryTokens: (intent) => summaryTokens[intent] },
            }),
            packager: new Packager(assets),
          }),
          writer,
          clock: systemClock,
          clientVersion: version,
          logger: logger.child('assembly'),
        }),
      }),
    },
    logger.child('rpc'),
  );

  const runGarbageCollection = (): void => {
    void collectGarbage.execute().then((result) => {
      if (result.ok) logger.info('Garbage collected', result.value);
      else logger.error('Garbage collection failed', { ...result.error });
    });
  };

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
        void browser.alarms.create(COLLECT_GARBAGE, {
          delayInMinutes: 1,
          periodInMinutes: COLLECT_GARBAGE_PERIOD_MIN,
        });
      };
      const onAlarm = (alarm: Browser.alarms.Alarm) => {
        if (alarm.name === COLLECT_GARBAGE) runGarbageCollection();
      };
      // A notice explains why capture failed on one page; it should not outlive that page.
      const onTabUpdated = (tabId: number, change: Browser.tabs.OnUpdatedInfo) => {
        if (change.status === 'loading') void notice.clear(tabId);
      };

      browser.commands.onCommand.addListener(onCommand);
      browser.contextMenus.onClicked.addListener(onMenuClick);
      browser.runtime.onInstalled.addListener(onInstalled);
      browser.runtime.onStartup.addListener(runGarbageCollection);
      browser.alarms.onAlarm.addListener(onAlarm);
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
        browser.runtime.onStartup.removeListener(runGarbageCollection);
        browser.alarms.onAlarm.removeListener(onAlarm);
        browser.tabs.onUpdated.removeListener(onTabUpdated);
      };
    },
  };
};
