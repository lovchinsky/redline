import { FragmentCatalog, type ErasedFragmentDescriptor, type Logger } from '@redline/core';
import type { ResolvedRegion } from '@redline/dom';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import type { CaptureContext, ErasedCollector } from './collector';
import { CaptureEngine } from './engine';
import { CollectionPlanner, PlanConfigError, type Profiles } from './planner';
import type { ShapeSubject, StepSubject } from './subject';

const descriptor = (kind: string): ErasedFragmentDescriptor => ({
  kind,
  title: kind,
  version: 1,
  schema: z.object({ value: z.string() }),
  migrations: [],
  presenter: { summarize: () => [] },
});

const catalog = new FragmentCatalog([descriptor('echo'), descriptor('page')]);

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const context = {
  document: {} as Document,
  dom: {} as CaptureContext['dom'],
  page: {
    url: 'https://acme.io/',
    title: 'Acme',
    viewport: { width: 1280, height: 800 },
    devicePixelRatio: 1,
    scroll: { x: 0, y: 0 },
    language: null,
    colorScheme: 'light',
  },
  images: { derive: () => Promise.reject(new Error('unused')) },
  log: silentLogger,
} satisfies CaptureContext;

const shape = (id: string): ShapeSubject => ({
  id,
  source: 'lasso',
  polygon: [],
  region: {} as ResolvedRegion,
  snapshot: {
    asset: { id: 'a' as never, mediaType: 'image/png', bytes: 1 },
    scroll: { x: 0, y: 0 },
    viewport: { width: 1280, height: 800 },
    devicePixelRatio: 1,
    sensitiveRects: [],
  },
});

const step: StepSubject = { intent: 'layout', comment: 'x', shapes: [shape('s1'), shape('s2')] };

const shapeCollector = (
  id: string,
  collect: Extract<ErasedCollector, { level: 'shape' }>['collect'],
  produces = 'echo',
): ErasedCollector => ({
  id,
  produces,
  level: 'shape',
  priority: 'normal',
  optionsSchema: z.undefined(),
  collect,
});

const stepCollector = (
  id: string,
  collect: Extract<ErasedCollector, { level: 'step' }>['collect'],
): ErasedCollector => ({
  id,
  produces: 'page',
  level: 'step',
  priority: 'high',
  optionsSchema: z.undefined(),
  collect,
});

const profiles = (ids: string[]): Profiles => ({
  text: { collectors: ids },
  style: { collectors: ids },
  layout: { collectors: ids },
  bug: { collectors: ids },
  'new-element': { collectors: ids },
});

const run = async (collectors: ErasedCollector[], timeoutMs = 200) => {
  const planner = new CollectionPlanner(collectors, profiles(collectors.map((c) => c.id)));
  const engine = new CaptureEngine(catalog, [], { defaultTimeoutMs: timeoutMs }, { now: () => 0 });
  return engine.run(planner.plan('layout'), step, context);
};

describe('CaptureEngine', () => {
  it('runs step collectors once and shape collectors once per shape', async () => {
    const capture = await run([
      stepCollector('page', () =>
        Promise.resolve({ status: 'collected', items: [{ data: { value: 'p' } }] }),
      ),
      shapeCollector('echo', ({ shape: s }) =>
        Promise.resolve({ status: 'collected', items: [{ data: { value: s.id } }] }),
      ),
    ]);

    expect(capture.fragments).toEqual([
      {
        kind: 'page',
        version: 1,
        target: { level: 'step' },
        priority: 'high',
        data: { value: 'p' },
        assets: [],
      },
      {
        kind: 'echo',
        version: 1,
        target: { level: 'shape', shapeId: 's1' },
        priority: 'normal',
        data: { value: 's1' },
        assets: [],
      },
      {
        kind: 'echo',
        version: 1,
        target: { level: 'shape', shapeId: 's2' },
        priority: 'normal',
        data: { value: 's2' },
        assets: [],
      },
    ]);
    expect(capture.diagnostics).toEqual([]);
  });

  it('keeps collecting when a collector throws', async () => {
    const capture = await run([
      stepCollector('page', () => Promise.reject(new Error('boom'))),
      shapeCollector('echo', () =>
        Promise.resolve({ status: 'collected', items: [{ data: { value: 'ok' } }] }),
      ),
    ]);

    expect(capture.fragments).toHaveLength(2);
    expect(capture.diagnostics).toEqual([
      expect.objectContaining({ source: 'page', outcome: 'failed', message: 'boom' }),
    ]);
  });

  it('times out a slow collector and aborts its signal', async () => {
    let aborted = false;
    const capture = await run(
      [
        shapeCollector('echo', ({ signal }) => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
          return new Promise(() => undefined);
        }),
      ],
      20,
    );

    expect(capture.fragments).toEqual([]);
    expect(capture.diagnostics.map((d) => d.outcome)).toEqual(['timed-out', 'timed-out']);
    expect(aborted).toBe(true);
  });

  it('records not-applicable outcomes and rejects output that breaks the schema', async () => {
    const capture = await run([
      stepCollector('page', () =>
        Promise.resolve({ status: 'not-applicable', reason: 'prod build' }),
      ),
      shapeCollector('echo', () =>
        Promise.resolve({ status: 'collected', items: [{ data: { value: 42 } }] }),
      ),
    ]);

    expect(capture.fragments).toEqual([]);
    expect(capture.diagnostics.map((d) => [d.source, d.outcome])).toEqual([
      ['page', 'not-applicable'],
      ['echo', 'invalid-output'],
      ['echo', 'invalid-output'],
    ]);
  });

  it('lets an item override the collector priority', async () => {
    const capture = await run([
      shapeCollector('echo', () =>
        Promise.resolve({
          status: 'collected',
          items: [{ data: { value: 'x' }, priority: 'critical' }],
        }),
      ),
    ]);
    expect(capture.fragments.map((f) => f.priority)).toEqual(['critical', 'critical']);
  });
});

describe('CollectionPlanner', () => {
  const echo = shapeCollector('echo', () =>
    Promise.resolve({ status: 'not-applicable', reason: '' }),
  );
  const limited: ErasedCollector = {
    ...echo,
    id: 'limited',
    optionsSchema: z.object({ limit: z.int() }),
  };

  it('resolves options for every profile entry', () => {
    const planner = new CollectionPlanner([echo, limited], {
      ...profiles(['echo']),
      layout: { collectors: ['echo', ['limited', { limit: 3 }]] },
    });
    expect(planner.plan('layout').invocations.map((i) => [i.collector.id, i.options])).toEqual([
      ['echo', undefined],
      ['limited', { limit: 3 }],
    ]);
  });

  it.each([
    ['an unknown collector', [echo], profiles(['nope'])],
    ['invalid options', [echo, limited], profiles(['limited'])],
    ['a duplicated collector id', [echo, echo], profiles(['echo'])],
  ] as [string, ErasedCollector[], Profiles][])(
    'fails at construction on %s',
    (_, collectors, config) => {
      expect(() => new CollectionPlanner(collectors, config)).toThrow(PlanConfigError);
    },
  );
});
