import { ok, type AppError, type Logger, type Result } from '@redline/core';
import { DocumentDomQuery, EnclosureResolver, summarizeRegion } from '@redline/dom';
import { RpcServer, tabProtocol } from '@redline/rpc';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { RuntimeServerTransport } from '../adapters/messaging/runtime-server-transport';
import { ConsoleLogger } from '../adapters/system/console-logger';
import { uuidIdGenerator } from '../adapters/system/uuid-id-generator';
import { CaptureRuntime } from '../ui/overlay/capture-runtime';
import { CaptureSession, type ResolvedCapture } from '../ui/overlay/capture-session';
import { OverlayHost } from '../ui/overlay/overlay-host';
import overlayCss from '../ui/overlay/overlay.css?inline';

/**
 * The step hand-off point. Phase 1 records what was captured; the context collection
 * pipeline (phase 2) plugs in here and turns the capture into a stored step.
 */
const recordCapture =
  (logger: Logger) =>
  (capture: ResolvedCapture): Promise<Result<void, AppError>> => {
    logger.info('Step captured', {
      intent: capture.intent,
      comment: capture.comment,
      regions: capture.shapes.map(({ region }) => summarizeRegion(region)),
    });
    return Promise.resolve(ok(undefined));
  };

/**
 * Composition root of the capture content script. The service worker injects it only when no
 * running copy answers; should two injections race, WXT invalidates the older context, whose
 * teardown below leaves exactly one runtime per document.
 */
export const startContentRuntime = (ctx: ContentScriptContext): void => {
  const logger = new ConsoleLogger('capture');
  const runtime = new CaptureRuntime(() => {
    const host = OverlayHost.mount(document, overlayCss);
    const dom = new DocumentDomQuery(document, (element) => host.owns(element));
    return new CaptureSession({
      view: window,
      host,
      dom,
      resolver: new EnclosureResolver(dom),
      ids: uuidIdGenerator,
      logger: logger.child('session'),
      commit: recordCapture(logger),
    });
  }, logger);

  const server = new RpcServer(
    tabProtocol,
    { 'capture.start': () => Promise.resolve(ok({ status: runtime.start() })) },
    logger.child('rpc'),
  );
  const stopServer = server.listen(new RuntimeServerTransport());

  ctx.onInvalidated(() => {
    stopServer();
    runtime.dispose();
  });
};
