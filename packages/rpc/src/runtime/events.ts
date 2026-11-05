import { parseWith, type AppError, type Logger, type Result } from '@redline/core';
import type { EventName, EventsDefinition, PayloadOf } from './define';
import { EVENT_TYPE, eventEnvelopeSchema, hasEnvelopeType } from './envelope';
import type { EventSink, EventSource, Unsubscribe } from './transport';

export class EventPublisher<E extends EventsDefinition<E>> {
  constructor(
    private readonly events: E,
    private readonly sink: EventSink,
  ) {}

  publish<N extends EventName<E>>(name: N, payload: PayloadOf<E, N>): Result<void, AppError> {
    const parsed = parseWith(this.events[name], payload);
    if (!parsed.ok) return parsed;
    this.sink.publish({ type: EVENT_TYPE, name, payload: parsed.value });
    return { ok: true, value: undefined };
  }
}

export class EventSubscriber<E extends EventsDefinition<E>> {
  constructor(
    private readonly events: E,
    private readonly source: EventSource,
    private readonly logger: Logger,
  ) {}

  on<N extends EventName<E>>(name: N, listener: (payload: PayloadOf<E, N>) => void): Unsubscribe {
    const schema = this.events[name];
    return this.source.subscribe((message) => {
      if (!hasEnvelopeType(message, EVENT_TYPE)) return;
      const envelope = parseWith(eventEnvelopeSchema, message);
      if (!envelope.ok || envelope.value.name !== name) return;
      const payload = parseWith(schema, envelope.value.payload);
      if (!payload.ok) {
        this.logger.warn('Dropped event with invalid payload', { name, ...payload.error });
        return;
      }
      listener(payload.value);
    });
  }
}
