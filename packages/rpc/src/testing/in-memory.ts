import { appError, err, ok } from '@redline/core';
import type {
  CallerInfo,
  ClientTransport,
  EventSink,
  EventSource,
  RequestHandler,
  ServerTransport,
} from '../runtime/transport';

/**
 * In-process transports for tests. Messages are structured-cloned to reproduce
 * the serialization boundary between extension contexts.
 */
export const createInMemoryBus = (caller: CallerInfo = { kind: 'extension' }) => {
  const handlers = new Set<RequestHandler>();
  const listeners = new Set<(message: unknown) => void>();

  /** A client whose requests arrive as sent by `as`, e.g. a content script in some tab. */
  const clientAs = (as: CallerInfo): ClientTransport => ({
    async send(request) {
      for (const handler of handlers) {
        const reply = handler(structuredClone(request), as);
        if (reply !== undefined) return ok(structuredClone(await reply));
      }
      return err(appError('transport', 'No receiver for request'));
    },
  });
  const client = clientAs(caller);

  const server: ServerTransport = {
    listen(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };

  const sink: EventSink = {
    publish(event) {
      for (const listener of listeners) listener(structuredClone(event));
    },
  };

  const source: EventSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return { client, clientAs, server, sink, source };
};
