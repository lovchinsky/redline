import { AssemblyEngine, MarkdownContextRenderer, Packager } from '@redline/assembly';
import {
  FragmentCatalog,
  SerialQueue,
  type Clock,
  type IdGenerator,
  type Logger,
} from '@redline/core';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { dedupeProcessor } from '@redline/processors';
import { SUMMARY_TOKENS_PER_STEP } from '@redline/profiles';
import { EventPublisher, events, type EventSink } from '@redline/rpc';
import { IdbActiveDraftStore } from '../adapters/idb/idb-active-draft-store';
import { IdbAssetStore } from '../adapters/idb/idb-asset-store';
import { IdbBundleRepository } from '../adapters/idb/idb-bundle-repository';
import { IdbCaptureRepository } from '../adapters/idb/idb-capture-repository';
import { IdbTaskRepository } from '../adapters/idb/idb-task-repository';
import { HttpReceiverClient } from '../adapters/receiver/http-receiver-client';
import { StorageBindingStore } from '../adapters/storage/storage-bindings';
import { StorageJournalStore } from '../adapters/storage/storage-journal';
import { StorageSettingsStore } from '../adapters/storage/storage-settings';
import type { DatabaseConnection } from '../adapters/idb/database';
import type { Fetch } from '../adapters/receiver/http-receiver-client';
import type { StorageArea } from '../adapters/storage/storage-area';
import { DeriveImage, TakeSnapshot } from '../application/capture/capture-assets';
import { createCaptureHandlers } from '../application/capture/capture-handlers';
import { InjectPageRuntime, SyncPageRuntime } from '../application/capture/page-runtime';
import { StartCapture } from '../application/capture/start-capture';
import { DeliverQueued } from '../application/delivery/deliver-queued';
import { createDeliveryHandlers } from '../application/delivery/delivery-handlers';
import { createDiagnosticsHandlers } from '../application/diagnostics/diagnostics-handlers';
import { DiagnosticsJournal } from '../application/diagnostics/diagnostics-journal';
import { FollowRemote } from '../application/delivery/follow-remote';
import {
  ActivityObserver,
  NotificationObserver,
  UiTaskEvents,
  WakeUpPlanner,
} from '../application/delivery/observers';
import { ManageSettings } from '../application/delivery/settings';
import {
  ReopenDraft,
  ResolveDeliveryTarget,
  RetryDelivery,
  SubmitTask,
} from '../application/delivery/submit-task';
import { AssembleBundle, BundleAssembler } from '../application/drafts/assemble-bundle';
import { CollectGarbage } from '../application/drafts/collect-garbage';
import { CommitStep } from '../application/drafts/commit-step';
import {
  ActivateDraft,
  CreateDraft,
  DeleteTask,
  EditDraft,
  RemoveStep,
} from '../application/drafts/draft-commands';
import { createDraftHandlers } from '../application/drafts/draft-handlers';
import { GetDraft, ListDrafts, ListTasks } from '../application/drafts/draft-queries';
import { StoredCaptures } from '../application/drafts/stored-captures';
import { createSystemHandlers } from '../application/system/system-handlers';
import { TaskWriter } from '../application/tasks/task-writer';
import type {
  CaptureScriptInjector,
  CaptureUnavailableNotice,
  GrantedHosts,
  ImageDeriver,
  PageRuntimeInjector,
  PageRuntimeRegistration,
  TabCaptureClient,
  ViewportCapturer,
} from '../ports/capture';
import type { ActivityIndicator, Notifier, WakeUps } from '../ports/delivery';

/**
 * Everything the service worker takes from the browser. The extension passes Chrome adapters;
 * integration tests pass in-memory ones and get the very same object graph.
 */
export interface BackgroundPlatform {
  readonly version: string;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly database: DatabaseConnection;
  /** `storage.local`: settings, bindings and the Diagnostics journal. */
  readonly storage: StorageArea;
  readonly fetch: Fetch;
  readonly eventSink: EventSink;
  readonly wakeUps: WakeUps;
  readonly notifier: Notifier;
  readonly activity: ActivityIndicator;
  readonly notice: CaptureUnavailableNotice;
  readonly injector: CaptureScriptInjector;
  readonly tabs: TabCaptureClient;
  readonly capturer: ViewportCapturer;
  readonly deriver: ImageDeriver;
  readonly pageRuntimeInjector: PageRuntimeInjector;
  readonly pageRuntimeRegistration: PageRuntimeRegistration;
  readonly grantedHosts: GrantedHosts;
}

/** Captures kept in the Diagnostics journal. */
const DIAGNOSTICS_CAPACITY = 50;

/** The service worker's object graph: every adapter and use case, wired once. */
export const createBackgroundServices = (platform: BackgroundPlatform, logger: Logger) => {
  const { version, clock, ids, database, notice } = platform;
  const publisher = new EventPublisher(events, platform.eventSink);

  // Storage
  const assets = new IdbAssetStore(database, ids, clock);
  const captureRepository = new IdbCaptureRepository(database);
  const tasks = new IdbTaskRepository(database);
  const active = new IdbActiveDraftStore(database);
  const bundles = new IdbBundleRepository(database);
  const settingsStore = new StorageSettingsStore(platform.storage);
  const bindingStore = new StorageBindingStore(platform.storage);
  const receiver = new HttpReceiverClient(settingsStore, platform.fetch, () => clock.now());
  const catalog = new FragmentCatalog(fragmentDescriptors);

  // Every task write goes through one queue and is announced to these observers.
  const activity = new ActivityObserver(tasks, platform.activity);
  const wakeUps = new WakeUpPlanner(tasks, platform.wakeUps);
  const writer = new TaskWriter({
    queue: new SerialQueue(),
    observers: [
      new UiTaskEvents(active, publisher, logger.child('ui-events')),
      activity,
      new NotificationObserver(platform.notifier),
      wakeUps,
    ],
    logger: logger.child('tasks'),
  });

  const captures = new StoredCaptures({
    repository: captureRepository,
    assets,
    catalog,
    logger: logger.child('captures'),
  });
  const assembler = new BundleAssembler({
    tasks,
    captures,
    bundles,
    engine: new AssemblyEngine({
      processors: [dedupeProcessor],
      renderer: new MarkdownContextRenderer(catalog, {
        budget: { summaryTokensPerStep: SUMMARY_TOKENS_PER_STEP },
      }),
      packager: new Packager(assets),
    }),
    clock,
    clientVersion: version,
    logger: logger.child('assembly'),
  });
  const outbox = new DeliverQueued({
    tasks,
    bundles,
    receiver,
    writer,
    clock,
    logger: logger.child('outbox'),
  });
  const followRemote = new FollowRemote({
    tasks,
    receiver,
    writer,
    clock,
    logger: logger.child('status'),
  });
  const startCapture = new StartCapture({
    injector: platform.injector,
    tabs: platform.tabs,
    notice,
    logger: logger.child('capture'),
  });

  const commands = { tasks, active, bundles, captures, writer, ids, clock };
  const queries = { tasks, active, captures, catalog };
  const deliveryActions = { tasks, active, outbox, writer, clock };

  const handlers = {
    ...createSystemHandlers({ clock, version, events: publisher, logger: logger.child('system') }),
    ...createDiagnosticsHandlers(
      new DiagnosticsJournal({
        store: new StorageJournalStore(platform.storage),
        queue: new SerialQueue(),
        ids,
        clock,
        events: publisher,
        capacity: DIAGNOSTICS_CAPACITY,
        logger: logger.child('diagnostics'),
      }),
    ),
    ...createCaptureHandlers({
      startCapture,
      takeSnapshot: new TakeSnapshot(platform.capturer, assets),
      deriveImage: new DeriveImage(platform.deriver, assets),
      commitStep: new CommitStep({
        catalog,
        captures: captureRepository,
        tasks,
        active,
        writer,
        ids,
        clock,
        logger: logger.child('steps'),
      }),
      injectPageRuntime: new InjectPageRuntime(platform.pageRuntimeInjector),
    }),
    ...createDraftHandlers({
      listDrafts: new ListDrafts(queries),
      getDraft: new GetDraft(queries),
      listTasks: new ListTasks(queries),
      createDraft: new CreateDraft(commands),
      activateDraft: new ActivateDraft(commands),
      editDraft: new EditDraft(commands),
      removeStep: new RemoveStep(commands),
      deleteTask: new DeleteTask(commands),
      assembleBundle: new AssembleBundle(assembler, writer),
    }),
    ...createDeliveryHandlers({
      resolveTarget: new ResolveDeliveryTarget({ tasks, bindings: bindingStore }),
      submitTask: new SubmitTask({
        tasks,
        active,
        bindings: bindingStore,
        assembler,
        outbox,
        writer,
        events: publisher,
        clock,
        logger: logger.child('submit'),
      }),
      retryDelivery: new RetryDelivery(deliveryActions),
      reopenDraft: new ReopenDraft(deliveryActions),
      followRemote,
      settings: new ManageSettings({
        settings: settingsStore,
        bindings: bindingStore,
        receiver,
        writer,
        events: publisher,
        clock,
        logger: logger.child('settings'),
      }),
    }),
  };

  return {
    version,
    handlers,
    startCapture,
    notice,
    tasks,
    assets,
    outbox,
    followRemote,
    activity,
    wakeUps,
    syncPageRuntime: new SyncPageRuntime({
      bindings: bindingStore,
      granted: platform.grantedHosts,
      registration: platform.pageRuntimeRegistration,
      logger: logger.child('page-runtime'),
    }),
    collectGarbage: new CollectGarbage({
      tasks,
      captures: captureRepository,
      assets,
      writer,
      clock,
      logger: logger.child('gc'),
    }),
  };
};

export type BackgroundServices = ReturnType<typeof createBackgroundServices>;
