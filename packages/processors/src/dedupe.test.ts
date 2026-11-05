import {
  FragmentSet,
  type AnyFragment,
  type AssemblyStep,
  type AssetId,
  type FragmentBase,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import { dedupeProcessor } from './dedupe';

const fragment = (overrides: Partial<FragmentBase>): AnyFragment => ({
  kind: 'anchors',
  version: 1,
  target: { level: 'step' },
  priority: 'normal',
  data: {},
  assets: [],
  ...overrides,
});

const step = (id: string, shapeIds: string[], fragments: AnyFragment[]): AssemblyStep => ({
  id,
  shapeIds,
  fragments: FragmentSet.of(fragments),
  references: [],
});

const page = (url: string) => fragment({ kind: 'page-meta', data: { url, title: 'Pricing' } });
const anchors = (shapeId: string, value: string) =>
  fragment({ target: { level: 'shape', shapeId }, data: { anchors: [{ value }] } });

describe('dedupeProcessor', () => {
  it('replaces later identical fragments with a reference to the first one', () => {
    const [first, second] = dedupeProcessor.process([
      step('s1', ['a1'], [page('https://acme.io/pricing'), anchors('a1', 'Buy')]),
      step(
        's2',
        ['b1', 'b2'],
        [page('https://acme.io/pricing'), anchors('b1', 'Sell'), anchors('b2', 'Buy')],
      ),
    ]);
    expect(first?.references).toEqual([]);
    expect(first?.fragments.fragments).toHaveLength(2);
    expect(second?.fragments.fragments.map((f) => f.target)).toEqual([
      { level: 'shape', shapeId: 'b1' },
    ]);
    expect(second?.references).toEqual([
      {
        kind: 'page-meta',
        target: { level: 'step' },
        original: { stepId: 's1', target: { level: 'step' } },
      },
      {
        kind: 'anchors',
        target: { level: 'shape', shapeId: 'b2' },
        original: { stepId: 's1', target: { level: 'shape', shapeId: 'a1' } },
      },
    ]);
  });

  it('compares data regardless of key order', () => {
    const [, second] = dedupeProcessor.process([
      step('s1', [], [fragment({ data: { a: 1, b: 2 } })]),
      step('s2', [], [fragment({ data: { b: 2, a: 1 } })]),
    ]);
    expect(second?.fragments.fragments).toEqual([]);
  });

  it('never folds fragments that carry assets, nor different kinds or versions', () => {
    const asset = { id: 'x' as AssetId, mediaType: 'image/png', bytes: 1 };
    const steps = [
      step('s1', [], [fragment({ assets: [asset] }), fragment({ kind: 'layout' })]),
      step(
        's2',
        [],
        [
          fragment({ assets: [asset] }),
          fragment({ kind: 'region' }),
          fragment({ kind: 'layout', version: 2 }),
        ],
      ),
    ];
    const [, second] = dedupeProcessor.process(steps);
    expect(second).toBe(steps[1]);
  });

  it('follows document order within a step: areas in the order they were drawn', () => {
    const [only] = dedupeProcessor.process([
      step('s1', ['late', 'early'], [anchors('early', 'Buy'), anchors('late', 'Buy')]),
    ]);
    expect(only?.references).toEqual([
      {
        kind: 'anchors',
        target: { level: 'shape', shapeId: 'early' },
        original: { stepId: 's1', target: { level: 'shape', shapeId: 'late' } },
      },
    ]);
  });
});
