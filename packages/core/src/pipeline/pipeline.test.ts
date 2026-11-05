import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { CatalogConfigError, FragmentCatalog } from './catalog';
import { defineFragment } from './descriptor';
import type { FragmentEnvelope } from './fragment';
import { FragmentSet } from './fragment-set';
import { runProcessors, type FragmentProcessor } from './processor';

declare module './fragment' {
  interface FragmentRegistry {
    'test-note': { text: string; lang: string };
    'test-count': { count: number };
  }
}

const noteV2 = defineFragment({
  kind: 'test-note',
  title: 'Note',
  version: 2,
  schema: z.object({ text: z.string(), lang: z.string() }),
  migrations: [
    {
      fromVersion: 1,
      migrate: (data) => ({ ...(data as { text: string }), lang: 'en' }),
    },
  ],
  presenter: { summarize: (f) => [{ section: 'page', markdown: f.data.text }] },
});

const count = defineFragment({
  kind: 'test-count',
  title: 'Count',
  version: 1,
  schema: z.object({ count: z.int() }),
  migrations: [],
  presenter: { summarize: (f) => [{ section: 'page', markdown: String(f.data.count) }] },
});

const envelope = (overrides: Partial<FragmentEnvelope> = {}): FragmentEnvelope => ({
  kind: 'test-note',
  version: 2,
  target: { level: 'step' },
  priority: 'normal',
  data: { text: 'hi', lang: 'uk' },
  assets: [],
  ...overrides,
});

describe('FragmentCatalog', () => {
  const catalog = new FragmentCatalog([noteV2, count]);

  it('accepts a valid fragment', () => {
    expect(catalog.parseFragment(envelope())).toEqual({ ok: true, value: envelope() });
  });

  it('migrates data written by an older module version', () => {
    const parsed = catalog.parseFragment(envelope({ version: 1, data: { text: 'old' } }));
    expect(parsed).toEqual({
      ok: true,
      value: envelope({ version: 2, data: { text: 'old', lang: 'en' } }),
    });
  });

  it.each([
    ['unknown kinds', envelope({ kind: 'nope' })],
    ['data that breaks the schema', envelope({ data: { text: 1 } })],
    ['data newer than the code', envelope({ version: 3 })],
    ['malformed envelopes', { kind: 'test-note' }],
  ])('rejects %s', (_, raw) => {
    const parsed = catalog.parseFragment(raw);
    expect(parsed.ok ? null : parsed.error.code).toBe('validation');
  });

  it('refuses two descriptors for one kind', () => {
    expect(() => new FragmentCatalog([count, count])).toThrow(CatalogConfigError);
  });

  it('parses a whole capture and fails on the first bad fragment', () => {
    expect(catalog.parseCapture({ fragments: [envelope()], diagnostics: [] }).ok).toBe(true);
    expect(
      catalog.parseCapture({ fragments: [envelope(), envelope({ kind: 'nope' })], diagnostics: [] })
        .ok,
    ).toBe(false);
  });
});

describe('FragmentSet', () => {
  const step = envelope() as never;
  const shape = {
    ...envelope({ kind: 'test-count', data: { count: 3 } }),
    target: { level: 'shape', shapeId: 's1' },
  } as never;

  it('selects by kind and by target', () => {
    const set = FragmentSet.of([step, shape]);
    expect(set.ofKind('test-count')).toEqual([shape]);
    expect(set.forTarget({ level: 'shape', shapeId: 's1' })).toEqual([shape]);
    expect(set.forTarget({ level: 'step' })).toEqual([step]);
  });

  it('never mutates: every change returns a new set', () => {
    const original = FragmentSet.of([step]);
    const changed = original.with([shape]);
    expect(original.fragments).toHaveLength(1);
    expect(changed.fragments).toHaveLength(2);
  });
});

describe('runProcessors', () => {
  it('runs processors in order on the previous output', async () => {
    const tag = (id: string): FragmentProcessor<string[]> => ({
      id,
      process: (set, seen) => {
        seen.push(id);
        return set.withDiagnostics([
          {
            source: id,
            target: { level: 'step' },
            outcome: 'not-applicable',
            message: '',
            durationMs: 0,
          },
        ]);
      },
    });
    const seen: string[] = [];
    const result = await runProcessors([tag('a'), tag('b')], FragmentSet.of(), seen);
    expect(seen).toEqual(['a', 'b']);
    expect(result.diagnostics.map((d) => d.source)).toEqual(['a', 'b']);
  });
});
