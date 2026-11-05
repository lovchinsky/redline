import { appError, err, ok, type IdGenerator, type Logger } from '@redline/core';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod/mini';
import { createInMemoryBus } from '../testing/in-memory';
import { RpcClient } from './client';
import { defineEvents, defineProtocol } from './define';
import { REQUEST_TYPE, RESPONSE_TYPE } from './envelope';
import { EventPublisher, EventSubscriber } from './events';
import { RpcServer, type ProtocolHandlers } from './server';

const protocol = defineProtocol({
  'math.double': {
    request: z.object({ n: z.number() }),
    response: z.object({ result: z.number() }),
  },
  'math.fail': {
    request: z.object({}),
    response: z.object({}),
  },
});

const events = defineEvents({
  'math.doubled': z.object({ n: z.number() }),
  'math.other': z.object({ s: z.string() }),
});

const sequentialIds = (): IdGenerator => {
  let n = 0;
  return { next: () => `id-${String((n += 1))}` };
};

const createLogger = (): Logger & { errors: unknown[] } => {
  const errors: unknown[] = [];
  const logger: Logger & { errors: unknown[] } = {
    errors,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, context) => errors.push({ message, context }),
    child: () => logger,
  };
  return logger;
};

const setup = (overrides: Partial<ProtocolHandlers<typeof protocol>> = {}) => {
  const bus = createInMemoryBus({ tabId: 7 });
  const logger = createLogger();
  const handlers: ProtocolHandlers<typeof protocol> = {
    'math.double': ({ n }) => Promise.resolve(ok({ result: n * 2 })),
    'math.fail': () => Promise.resolve(err(appError('not-found', 'nothing here'))),
    ...overrides,
  };
  new RpcServer(protocol, handlers, logger).listen(bus.server);
  const client = new RpcClient(protocol, bus.client, sequentialIds());
  return { bus, client, logger };
};

describe('RpcClient ↔ RpcServer', () => {
  it('round-trips a typed request', async () => {
    const { client } = setup();
    await expect(client.call('math.double', { n: 21 })).resolves.toEqual(ok({ result: 42 }));
  });

  it('passes trusted caller info from the transport to handlers', async () => {
    const handler = vi.fn(() => Promise.resolve(ok({ result: 0 })));
    const { client } = setup({ 'math.double': handler });
    await client.call('math.double', { n: 1 });
    expect(handler).toHaveBeenCalledWith({ n: 1 }, { tabId: 7 });
  });

  it('propagates handler errors as AppError', async () => {
    const { client } = setup();
    await expect(client.call('math.fail', {})).resolves.toEqual(
      err(appError('not-found', 'nothing here')),
    );
  });

  it('validates requests on the client before sending', async () => {
    const { client, bus } = setup();
    const send = vi.spyOn(bus.client, 'send');
    // @ts-expect-error -- deliberately wrong payload type
    const result = await client.call('math.double', { n: 'x' });
    expect(result.ok ? null : result.error.code).toBe('validation');
    expect(send).not.toHaveBeenCalled();
  });

  it('converts a thrown handler error into an internal error', async () => {
    const { client, logger } = setup({ 'math.double': () => Promise.reject(new Error('kaboom')) });
    const result = await client.call('math.double', { n: 1 });
    expect(result).toEqual(
      err({ code: 'internal', message: 'kaboom', details: { name: 'Error' } }),
    );
    expect(logger.errors).toHaveLength(1);
  });

  it('rejects a handler response that violates the protocol', async () => {
    const { client, logger } = setup({
      // @ts-expect-error -- deliberately wrong response type
      'math.double': () => Promise.resolve(ok({ result: 'not a number' })),
    });
    const result = await client.call('math.double', { n: 1 });
    expect(result.ok ? null : result.error.code).toBe('internal');
    expect(logger.errors).toHaveLength(1);
  });

  it('reports a transport failure when nothing is listening', async () => {
    const bus = createInMemoryBus();
    const client = new RpcClient(protocol, bus.client, sequentialIds());
    const result = await client.call('math.double', { n: 1 });
    expect(result.ok ? null : result.error.code).toBe('transport');
  });

  it('detects a response correlated with another request', async () => {
    const client = new RpcClient(
      protocol,
      {
        send: () =>
          Promise.resolve(
            ok({ type: RESPONSE_TYPE, id: 'other', result: { ok: true, value: { result: 1 } } }),
          ),
      },
      sequentialIds(),
    );
    const result = await client.call('math.double', { n: 1 });
    expect(result.ok ? null : result.error.code).toBe('transport');
  });
});

describe('RpcServer on a shared bus', () => {
  const dispatchRaw = async (message: unknown) => {
    const { bus } = setup();
    return bus.client.send(message as never);
  };

  it('ignores messages that are not RPC requests', async () => {
    const result = await dispatchRaw({ type: 'someone-else', id: '1' });
    expect(result.ok ? null : result.error.code).toBe('transport');
  });

  it('answers unknown methods with a validation error', async () => {
    const result = await dispatchRaw({ type: REQUEST_TYPE, id: '1', method: 'nope', payload: {} });
    expect(result).toEqual(
      ok({
        type: RESPONSE_TYPE,
        id: '1',
        result: { ok: false, error: { code: 'validation', message: 'Unknown RPC method: nope' } },
      }),
    );
  });

  it('validates request payloads on the server too', async () => {
    const result = await dispatchRaw({
      type: REQUEST_TYPE,
      id: '1',
      method: 'math.double',
      payload: { n: 'x' },
    });
    expect(result.ok && (result.value as { result: { ok: boolean } }).result.ok).toBe(false);
  });
});

describe('events', () => {
  it('delivers only the subscribed event with a validated payload', () => {
    const bus = createInMemoryBus();
    const publisher = new EventPublisher(events, bus.sink);
    const subscriber = new EventSubscriber(events, bus.source, createLogger());
    const received: number[] = [];
    const unsubscribe = subscriber.on('math.doubled', ({ n }) => received.push(n));

    publisher.publish('math.doubled', { n: 1 });
    publisher.publish('math.other', { s: 'ignored' });
    unsubscribe();
    publisher.publish('math.doubled', { n: 2 });

    expect(received).toEqual([1]);
  });

  it('refuses to publish an invalid payload', () => {
    const bus = createInMemoryBus();
    const publisher = new EventPublisher(events, bus.sink);
    // @ts-expect-error -- deliberately wrong payload type
    expect(publisher.publish('math.doubled', { n: 'x' }).ok).toBe(false);
  });

  it('drops malformed payloads from the wire', () => {
    const bus = createInMemoryBus();
    const subscriber = new EventSubscriber(events, bus.source, createLogger());
    const listener = vi.fn();
    subscriber.on('math.doubled', listener);
    bus.sink.publish({ type: 'redline.rpc.event', name: 'math.doubled', payload: { n: 'x' } });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('ProtocolHandlers', () => {
  it('requires a handler for every method at compile time', () => {
    // @ts-expect-error -- 'math.fail' handler is missing
    const incomplete: ProtocolHandlers<typeof protocol> = {
      'math.double': () => Promise.resolve(ok({ result: 0 })),
    };
    expect(incomplete).toBeDefined();
  });
});
