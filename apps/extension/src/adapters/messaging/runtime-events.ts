import type { Logger } from '@redline/core';
import type { EventSink, EventSource, Unsubscribe } from '@redline/rpc';
import { browser } from 'wxt/browser';

/**
 * Broadcasts events from the service worker to every open extension page.
 *
 * Delivery is best-effort by design: events only signal that state changed, and UI
 * contexts re-read state through RPC queries when they open. A missing receiver
 * (no extension page open) is therefore expected and not an error.
 */
export class RuntimeEventSink implements EventSink {
  constructor(private readonly logger: Logger) {}

  publish(event: Parameters<EventSink['publish']>[0]): void {
    browser.runtime.sendMessage(event).catch((cause: unknown) => {
      this.logger.debug('Event not delivered: no extension page is listening', {
        name: event.name,
        cause: String(cause),
      });
    });
  }
}

/** Receives broadcast events in an extension page. Never answers, so RPC replies are unaffected. */
export class RuntimeEventSource implements EventSource {
  subscribe(listener: (message: unknown) => void): Unsubscribe {
    const onMessage = (message: unknown): undefined => {
      listener(message);
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => {
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }
}
