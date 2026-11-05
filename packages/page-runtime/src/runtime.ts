import { ErrorLog } from './error-log';
import { NetworkLog } from './network';
import { traceComponents } from './probes';
import {
  PROTOCOL_VERSION,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type ObservedSince,
  type RuntimeReport,
  type RuntimeRequest,
  type RuntimeResponse,
} from './protocol';

const MAX_ERRORS = 5;
const MAX_FAILED_REQUESTS = 10;

/** Marks a window as served, so a second injection does not start a second runtime. */
const STARTED = Symbol.for('redline.page-runtime');

const isRequest = (value: unknown): value is RuntimeRequest => {
  if (typeof value !== 'object' || value === null) return false;
  const { v, id, op } = value as Record<string, unknown>;
  return (
    v === PROTOCOL_VERSION &&
    typeof id === 'string' &&
    (op === 'ping' || op === 'component-trace' || op === 'runtime-report')
  );
};

/**
 * Starts the page runtime in the MAIN world: observes errors and failed requests from now on,
 * and answers requests from the extension's content script. Idempotent per window.
 *
 * `observedSince`: 'page-load' when started at document_start (a bound site), otherwise
 * 'capture-start' (injected when the user started capturing).
 */
export const startPageRuntime = (view: Window, observedSince: ObservedSince): void => {
  const marked = view as unknown as Record<symbol, boolean | undefined>;
  if (marked[STARTED] === true) return;
  marked[STARTED] = true;

  const now = () => view.performance.now();
  const errors = new ErrorLog(view, now);
  const network = new NetworkLog(view, now);
  const document = view.document;

  const answer = (request: RuntimeRequest, target: EventTarget | undefined): unknown => {
    switch (request.op) {
      case 'ping':
        return { version: PROTOCOL_VERSION, observedSince };
      case 'component-trace':
        return target instanceof Element ? traceComponents(target, view) : null;
      case 'runtime-report':
        return {
          observedSince,
          errors: errors.report(MAX_ERRORS),
          failedRequests: network.report(MAX_FAILED_REQUESTS),
        } satisfies RuntimeReport;
    }
  };

  document.addEventListener(
    REQUEST_EVENT,
    (event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      let request: unknown;
      try {
        request = JSON.parse(event.detail);
      } catch {
        return;
      }
      if (!isRequest(request)) return;
      let response: RuntimeResponse;
      try {
        response = { id: request.id, ok: true, result: answer(request, event.composedPath()[0]) };
      } catch (cause) {
        response = { id: request.id, ok: false, error: String(cause) };
      }
      document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(response) }));
    },
    true,
  );
};
