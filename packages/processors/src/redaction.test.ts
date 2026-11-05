import { FragmentSet, type AnyFragment } from '@redline/core';
import { describe, expect, it } from 'vitest';
import { redactionProcessor } from './redaction';

const fragment = (data: unknown): AnyFragment => ({
  kind: 'note',
  version: 1,
  target: { level: 'step' },
  priority: 'normal',
  data,
  assets: [],
});

describe('redactionProcessor', () => {
  it('redacts every string at any depth, URLs with their parameters', async () => {
    const set = await redactionProcessor.process(
      FragmentSet.of([
        fragment({
          url: 'https://app.acme.io/orders?token=abc&tab=2',
          title: 'Orders — maria@acme.io',
          anchors: [{ value: 'Pay with 4242 4242 4242 4242', score: 3 }],
          count: 2,
          flag: null,
        }),
      ]),
      undefined,
    );
    expect(set.fragments[0]?.data).toEqual({
      url: 'https://app.acme.io/orders?token=[redacted]&tab=2',
      title: 'Orders — [email]',
      anchors: [{ value: 'Pay with [card]', score: 3 }],
      count: 2,
      flag: null,
    });
  });
});
