import type { AppError, Result } from '@redline/core';
import type { EventEnvelope, RequestEnvelope, ResponseEnvelope } from './envelope';

export type Unsubscribe = () => void;

/** Who sent a request. Filled in by the transport from trusted runtime data, never from the payload. */
export interface CallerInfo {
  readonly tabId?: number;
  readonly frameId?: number;
  readonly url?: string;
}

/** Client side of request/response messaging. Resolves with the raw, still untrusted reply. */
export interface ClientTransport {
  send(request: RequestEnvelope): Promise<Result<unknown, AppError>>;
}

/**
 * Server side of request/response messaging. The handler returns `undefined` for messages
 * that are not RPC requests so other listeners on a shared bus can process them.
 */
export type RequestHandler = (
  message: unknown,
  caller: CallerInfo,
) => Promise<ResponseEnvelope> | undefined;

export interface ServerTransport {
  listen(handler: RequestHandler): Unsubscribe;
}

/** Fan-out of events to every connected subscriber. */
export interface EventSink {
  publish(event: EventEnvelope): void;
}

/** Stream of raw, still untrusted event messages. */
export interface EventSource {
  subscribe(listener: (message: unknown) => void): Unsubscribe;
}
