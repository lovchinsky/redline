import { describe, expect, it } from 'vitest';
import { corroborate, type RunOutcome } from './run';

const quota: RunOutcome = { kind: 'quota-exhausted', resetAt: 10, snapshot: null };
const missing: RunOutcome = {
  kind: 'failed',
  reason: 'credential-missing',
  detail: 'gone',
  snapshot: null,
};

describe('corroborate', () => {
  it('lets a run wait for the limit or the credential only on the gateway’s word', () => {
    expect(corroborate(quota, { kind: 'quota-exhausted', resetAt: 99 })).toEqual({
      ...quota,
      resetAt: 99,
    });
    expect(corroborate(missing, { kind: 'credential-missing' })).toEqual(missing);
    for (const [claim, refusal] of [
      [quota, null],
      [quota, { kind: 'credential-missing' } as const],
      [missing, null],
      [missing, { kind: 'budget-exhausted' } as const],
    ] as const) {
      expect(corroborate(claim, refusal)).toMatchObject({ kind: 'failed', reason: 'agent-failed' });
    }
  });

  it('takes any other account as it is: it can only end the task or spend its attempts', () => {
    const infra: RunOutcome = { kind: 'failed', reason: 'infra', detail: 'oom', snapshot: null };
    expect(corroborate(infra, null)).toBe(infra);
  });
});
