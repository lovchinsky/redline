import { intentSchema as contractIntent } from '@redline/contract';
import { INTENTS } from '@redline/core';
import { describe, expect, it } from 'vitest';

/** The contract package is standalone by design; this guards it against drifting from the domain. */
describe('contract parity', () => {
  it('lists the same intents as the domain', () => {
    expect(contractIntent.options).toEqual([...INTENTS]);
  });
});
