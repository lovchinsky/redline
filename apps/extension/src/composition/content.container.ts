import { CaptureEngine, CollectionPlanner } from '@redline/capture';
import { FragmentCatalog, ok } from '@redline/core';
import { DocumentDomQuery, EnclosureResolver } from '@redline/dom';
import { collectors } from '@redline/modules/collectors';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { profiles } from '@redline/profiles';
import { RpcClient, RpcServer, protocol, tabProtocol } from '@redline/rpc';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { pageInfoOf } from '../adapters/capture/page-info';
import {
  RpcImagePort,
  RpcStepCommitter,
  RpcViewportSnapshots,
} from '../adapters/capture/rpc-capture-ports';
import { RuntimeClientTransport } from '../adapters/messaging/runtime-client-transport';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { RecordStep } from '../application/capture/record-step';
import { CaptureRuntime } from '../ui/overlay/capture-runtime';
import { CaptureSession } from '../ui/overlay/capture-session';
import { OverlayHost } from '../ui/overlay/overlay-host';
import overlayCss from '../ui/overlay/overlay.css?inline';

/** Per-collector time budgets; screenshots round-trip to the service worker twice. */
const EXECUTION_POLICY = { defaultTimeoutMs: 2000, timeouts: { screenshot: 10_000 } };

/** The overlay is never part of the page being described. */
const isOverlay = (element: Element): boolean => element.localName === OverlayHost.TAG;

/**
 * Composition root of the capture content script. The service worker injects it only when no
 * running copy answers; should two injections race, WXT invalidates the older context, whose
 * teardown below leaves exactly one runtime per document.
 */
export const startContentRuntime = (ctx: ContentScriptContext): void => {
  const logger = new ConsoleLogger('capture');
  const rpc = new RpcClient(protocol, new RuntimeClientTransport(), uuidIdGenerator);
  const dom = new DocumentDomQuery(document, isOverlay);
  const snapshots = new RpcViewportSnapshots(rpc, window, dom);

  const recordStep = new RecordStep({
    planner: new CollectionPlanner(collectors, profiles),
    engine: new CaptureEngine(
      new FragmentCatalog(fragmentDescriptors),
      [],
      EXECUTION_POLICY,
      systemClock,
    ),
    context: () => ({
      document,
      dom,
      page: pageInfoOf(window),
      images: new RpcImagePort(rpc),
      log: logger.child('collect'),
    }),
    committer: new RpcStepCommitter(rpc),
    logger: logger.child('record'),
  });

  const runtime = new CaptureRuntime({
    snapshots,
    logger,
    createSession: (initialSnapshot) =>
      new CaptureSession({
        view: window,
        host: OverlayHost.mount(document, overlayCss),
        dom,
        resolver: new EnclosureResolver(dom),
        ids: uuidIdGenerator,
        logger: logger.child('session'),
        snapshots,
        initialSnapshot,
        commit: async (step) => {
          const recorded = await recordStep.execute(step);
          if (recorded.ok) logger.info('Step added to draft', { ...recorded.value });
          return recorded;
        },
      }),
  });

  const server = new RpcServer(
    tabProtocol,
    { 'capture.start': async () => ok({ status: await runtime.start() }) },
    logger.child('rpc'),
  );
  const stopServer = server.listen(new RuntimeServerTransport());

  ctx.onInvalidated(() => {
    stopServer();
    runtime.dispose();
  });
};
