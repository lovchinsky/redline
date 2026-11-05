import { CaptureEngine, buildCollectionPlan } from '@redline/capture';
import { FragmentCatalog, ok } from '@redline/core';
import { DocumentDomQuery, ElementTraversal, EnclosureResolver } from '@redline/dom';
import { collectors } from '@redline/modules/collectors';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { captureProfile } from '@redline/profiles';
import { redactionProcessor } from '@redline/processors';
import { RpcClient, RpcServer, protocol, tabProtocol } from '@redline/rpc';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { pageInfoOf } from '../adapters/capture/page-info';
import {
  RpcCaptureJournal,
  RpcImagePort,
  RpcStepCommitter,
  RpcViewportSnapshots,
} from '../adapters/capture/rpc-capture-ports';
import { chromeMessages } from '../adapters/i18n/chrome-messages';
import { MessageTranslator } from '../adapters/i18n/message-translator';
import { RuntimeClientTransport } from '../adapters/messaging/runtime-client-transport';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { systemClock } from '../adapters/system/system-clock';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { RecordStep } from '../application/capture/record-step';
import { CaptureRuntime } from '../ui/overlay/capture-runtime';
import { CaptureSession } from '../ui/overlay/capture-session';
import { OverlayHost } from '../ui/overlay/overlay-host';
import kitCss from '../ui/kit/kit.css?inline';
import overlayCss from '../ui/overlay/overlay.css?inline';
import tokensCss from '../ui/shared/tokens.css?inline';
import { PageRuntimeClient } from '@redline/page-runtime/client';
import { BridgePageRuntime } from '../adapters/capture/bridge-page-runtime';

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
  const i18n = new MessageTranslator(chromeMessages);
  const rpc = new RpcClient(protocol, new RuntimeClientTransport(), uuidIdGenerator);
  const dom = new DocumentDomQuery(document, isOverlay);
  const snapshots = new RpcViewportSnapshots(rpc, window, dom);

  const pageRuntime = new BridgePageRuntime(
    new PageRuntimeClient(document, () => uuidIdGenerator.next()),
    rpc,
    logger.child('page-runtime'),
  );

  const recordStep = new RecordStep({
    plan: buildCollectionPlan(collectors, captureProfile),
    engine: new CaptureEngine(
      new FragmentCatalog(fragmentDescriptors),
      // Runs on every capture before anything leaves the page.
      [redactionProcessor],
      EXECUTION_POLICY,
      systemClock,
    ),
    context: () => ({
      document,
      dom,
      page: pageInfoOf(window),
      images: new RpcImagePort(rpc),
      pageRuntime,
      log: logger.child('collect'),
    }),
    committer: new RpcStepCommitter(rpc),
    journal: new RpcCaptureJournal(rpc, logger.child('journal')),
    logger: logger.child('record'),
  });

  const runtime = new CaptureRuntime({
    snapshots,
    logger,
    createSession: (initialSnapshot) =>
      new CaptureSession({
        view: window,
        host: OverlayHost.mount(document, [tokensCss, kitCss, overlayCss].join('\n')),
        dom,
        resolver: new EnclosureResolver(dom),
        traversal: new ElementTraversal(dom, document.body),
        i18n,
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
