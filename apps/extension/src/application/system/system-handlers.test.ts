import { describe, expect, it } from 'vitest';
import type { Logger } from '@redline/core';
import { EventPublisher, EventSubscriber, events } from '@redline/rpc';
import { createInMemoryBus } from '@redline/rpc/testing';
import { createSystemHandlers } from './system-handlers';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

describe('system.ping', () => {
  it('echoes the nonce with version and time, and announces the ping', async () => {
    const bus = createInMemoryBus();
    const announced: unknown[] = [];
    new EventSubscriber(events, bus.source, silentLogger).on('system.pinged', (payload) =>
      announced.push(payload),
    );
    const handlers = createSystemHandlers({
      clock: { now: () => 123 },
      version: '0.1.0',
      events: new EventPublisher(events, bus.sink),
      logger: silentLogger,
    });

    const result = await handlers['system.ping']({ nonce: 'n1' }, {});

    expect(result).toEqual({ ok: true, value: { nonce: 'n1', version: '0.1.0', receivedAt: 123 } });
    expect(announced).toEqual([{ nonce: 'n1', at: 123 }]);
  });
});
