import { GATEWAY_REFUSALS, type AgentReport } from '@redline/agent-protocol';
import { describe, expect, it } from 'vitest';
import { decideOutcome } from './outcome';

const report = (outcome: AgentReport['outcome']): AgentReport => ({
  outcome,
  summary: 'Cards stretch to the tallest',
  changes: [{ file: 'src/Card.css', why: 'align-items: stretch' }],
  verification: 'Unit tests pass',
  assumptions: [],
  explanation: outcome === 'no-change' ? 'They are equal already' : '',
});

const head = { head: 'b'.repeat(40) };

type Input = Parameters<typeof decideOutcome>[0];

/** How a run concludes from its end, with no change, gateway account or stop unless given. */
const conclude = (input: Partial<Input> & Pick<Input, 'end'>) =>
  decideOutcome({ change: null, gateway: null, stopped: null, ...input });

const decide = (input: Partial<Input> & Pick<Input, 'end'>) => conclude(input).result;

describe('decideOutcome', () => {
  it('takes a reported change only when the tree changed', () => {
    expect(
      decide({
        end: { kind: 'completed', report: report('change') },
        change: head,
        gateway: null,
      }),
    ).toEqual({ kind: 'change', head: head.head, report: report('change') });
    expect(
      decide({
        end: { kind: 'completed', report: report('change') },
        change: null,
        gateway: null,
      }),
    ).toMatchObject({ kind: 'no-change' });
  });

  it('takes the agent’s word for no change, and refuses a run without a report', () => {
    expect(
      decide({
        end: { kind: 'completed', report: report('no-change') },
        change: null,
        gateway: null,
      }),
    ).toEqual({ kind: 'no-change', explanation: 'They are equal already' });
    expect(
      decide({ end: { kind: 'completed', report: null }, change: null, gateway: null }),
    ).toMatchObject({ kind: 'failed', reason: 'agent-failed' });
  });

  it('reads a failed model request through the gateway’s account of the grant', () => {
    const apiError = { kind: 'api-error' as const, status: 403, detail: 'Forbidden' };
    const refusedBy = (
      refusal: (typeof GATEWAY_REFUSALS)[keyof typeof GATEWAY_REFUSALS],
      resetAt: string | null = null,
    ) =>
      decide({
        end: apiError,
        change: null,
        gateway: { state: 'refused', refusal, resetAt },
      });
    expect(refusedBy(GATEWAY_REFUSALS.budgetExhausted)).toMatchObject({
      reason: 'budget-exhausted',
    });
    expect(refusedBy(GATEWAY_REFUSALS.credentialMissing)).toEqual({ kind: 'credential-missing' });
    expect(refusedBy(GATEWAY_REFUSALS.credentialRefused)).toMatchObject({
      reason: 'model-access-failed',
    });
    expect(refusedBy(GATEWAY_REFUSALS.quotaExhausted, '2026-11-09T15:00:00.000Z')).toEqual({
      kind: 'quota-exhausted',
      resetAt: '2026-11-09T15:00:00.000Z',
    });
    expect(
      decide({
        end: { ...apiError, status: 529 },
        change: null,
        gateway: { state: 'active' },
      }),
    ).toMatchObject({ kind: 'failed', reason: 'infra' });
    expect(
      decide({
        end: { ...apiError, status: 400 },
        change: null,
        gateway: { state: 'active' },
      }),
    ).toMatchObject({ kind: 'failed', reason: 'agent-failed' });
    // A gateway that could not be asked may have refused the run in a way it waits out.
    expect(
      decide({ end: { ...apiError, status: 403 }, change: null, gateway: null }),
    ).toMatchObject({ kind: 'failed', reason: 'infra' });
  });

  it('names the limits a run ran into', () => {
    expect(decide({ end: { kind: 'budget' }, change: null, gateway: null })).toMatchObject({
      reason: 'budget-exhausted',
    });
    expect(decide({ end: { kind: 'stopped' }, change: head, stopped: 'stalled' })).toEqual({
      kind: 'failed',
      reason: 'agent-failed',
      detail: 'The agent stopped responding',
    });
    expect(decide({ end: { kind: 'stopped' }, stopped: 'timeout' })).toMatchObject({
      detail: 'The run took longer than allowed',
    });
  });

  it('keeps the session of a run that waits, and of no other', () => {
    const asked = {
      kind: 'asked' as const,
      call: 'toolu_1',
      question: { text: 'Which?', options: [] },
    };
    const pauses = (input: Partial<Input> & Pick<Input, 'end'>) => conclude(input).pauses;
    expect(pauses({ end: asked })).toBe(true);
    expect(
      pauses({
        end: { kind: 'api-error', status: 403, detail: '' },
        gateway: { state: 'refused', refusal: GATEWAY_REFUSALS.credentialMissing, resetAt: null },
      }),
    ).toBe(true);
    // A question the requester could not be shown ends the run: nothing waits on it.
    expect(pauses({ end: { ...asked, question: null } })).toBe(false);
    expect(pauses({ end: { kind: 'max-turns' } })).toBe(false);
  });
});
