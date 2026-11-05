import { SerialRateLimiter, TaskId, type Logger } from '@redline/core';
import { RpcServer, protocol, type Unsubscribe } from '@redline/rpc';
import { browser, type Browser } from 'wxt/browser';
import { BadgeNotice } from '../adapters/capture/badge-notice';
import { scriptingInjector } from '../adapters/capture/scripting-injector';
import { RpcTabCaptureClient } from '../adapters/capture/tab-capture-client';
import { VisibleTabCapturer } from '../adapters/capture/visible-tab-capturer';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { offscreenImageDeriver } from '../adapters/images/offscreen-image-deriver';
import { RuntimeEventSink } from '../adapters/messaging/runtime-events';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { AlarmWakeUps, WAKE_UP_ALARMS } from '../adapters/platform/alarm-wake-ups';
import { ChromeNotifier, NOTIFICATION_PREFIX } from '../adapters/platform/chrome-notifier';
import { ToolbarActivity } from '../adapters/platform/toolbar-activity';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { createBackgroundServices, type BackgroundPlatform } from './background.services';

/** Manifest command and context menu item that start capture on the current page. */
export const START_CAPTURE = 'start-capture';

/** `tabs.captureVisibleTab` allows two calls per second; keep a margin. */
const CAPTURE_INTERVAL_MS = 550;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The Chrome side of the service worker. */
const chromePlatform = (logger: Logger): BackgroundPlatform => ({
  version: browser.runtime.getManifest().version,
  clock: systemClock,
  ids: uuidIdGenerator,
  database: new DatabaseConnection(() => openDatabase({ logger: logger.child('db') })),
  storage: browser.storage.local,
  fetch: (input, init) => fetch(input, init),
  eventSink: new RuntimeEventSink(logger.child('events')),
  wakeUps: new AlarmWakeUps(logger.child('alarms')),
  notifier: new ChromeNotifier(browser.runtime.getURL('/icon/128.png'), logger.child('notify')),
  activity: new ToolbarActivity(logger.child('badge')),
  notice: new BadgeNotice(logger.child('notice')),
  injector: scriptingInjector,
  tabs: new RpcTabCaptureClient(uuidIdGenerator),
  capturer: new VisibleTabCapturer(new SerialRateLimiter(CAPTURE_INTERVAL_MS, systemClock, sleep)),
  deriver: offscreenImageDeriver,
});

/** Alarm that deletes unreferenced captures and images. */
const COLLECT_GARBAGE = 'collect-garbage';
const COLLECT_GARBAGE_PERIOD_MIN = 6 * 60;

/**
 * Composition root of the service worker: the only place that knows concrete adapters.
 * `start` attaches every listener synchronously, as MV3 requires for wake-up events.
 */
export const createBackgroundContainer = () => {
  const logger = new ConsoleLogger('background');
  const services = createBackgroundServices(chromePlatform(logger), logger);
  const server = new RpcServer(protocol, services.handlers, logger.child('rpc'));

  const runGarbageCollection = (): void => {
    void services.collectGarbage.execute().then((result) => {
      if (result.ok) logger.info('Garbage collected', result.value);
      else logger.error('Garbage collection failed', { ...result.error });
    });
  };

  /** Work that may have come due while the worker was stopped. */
  const catchUp = (): void => {
    void services.outbox.run();
    void services.followRemote.checkStatuses();
    void services.activity.refresh();
    void services.wakeUps.plan();
  };

  /** User gestures (shortcut, context menu) grant activeTab for the tab they target. */
  const startCaptureFromGesture = (tab: Browser.tabs.Tab | undefined): void => {
    if (tab?.id === undefined) return;
    void services.startCapture.execute({ tabId: tab.id, url: tab.url });
  };

  /** A click on a task notification opens its result, or the side panel to answer. */
  const openTask = async (notificationId: string): Promise<void> => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const taskId = TaskId.safeParse(notificationId.slice(NOTIFICATION_PREFIX.length));
    if (!taskId.success) return;
    await browser.notifications.clear(notificationId);
    const task = await services.tasks.get(taskId.data);
    if (
      task.ok &&
      task.value.state.kind === 'submitted' &&
      task.value.state.status.phase === 'result-ready'
    ) {
      await browser.tabs.create({ url: task.value.state.status.resultUrl });
      return;
    }
    const window = await browser.windows.getLastFocused();
    if (window.id !== undefined) await browser.sidePanel.open({ windowId: window.id });
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
        if (alarm.name === WAKE_UP_ALARMS.deliver) void services.outbox.run();
        if (alarm.name === WAKE_UP_ALARMS['check-statuses'])
          void services.followRemote.checkStatuses();
      };
      const onNotificationClick = (notificationId: string) => {
        void openTask(notificationId).catch((cause: unknown) => {
          logger.warn('Could not open a task from a notification', { cause: String(cause) });
        });
      };
      // A notice explains why capture failed on one page; it should not outlive that page.
      const onTabUpdated = (tabId: number, change: Browser.tabs.OnUpdatedInfo) => {
        if (change.status === 'loading') void services.notice.clear(tabId);
      };
      const onStartup = () => {
        runGarbageCollection();
      };

      browser.commands.onCommand.addListener(onCommand);
      browser.contextMenus.onClicked.addListener(onMenuClick);
      browser.runtime.onInstalled.addListener(onInstalled);
      browser.runtime.onStartup.addListener(onStartup);
      browser.alarms.onAlarm.addListener(onAlarm);
      browser.notifications.onClicked.addListener(onNotificationClick);
      browser.tabs.onUpdated.addListener(onTabUpdated);
      browser.sidePanel
        .setPanelBehavior({ openPanelOnActionClick: true })
        .catch((cause: unknown) => {
          logger.error('Could not enable the side panel on action click', { cause: String(cause) });
        });
      catchUp();
      logger.info('Service worker started', { version: services.version });

      return () => {
        stopServer();
        browser.commands.onCommand.removeListener(onCommand);
        browser.contextMenus.onClicked.removeListener(onMenuClick);
        browser.runtime.onInstalled.removeListener(onInstalled);
        browser.runtime.onStartup.removeListener(onStartup);
        browser.alarms.onAlarm.removeListener(onAlarm);
        browser.notifications.onClicked.removeListener(onNotificationClick);
        browser.tabs.onUpdated.removeListener(onTabUpdated);
      };
    },
  };
};
