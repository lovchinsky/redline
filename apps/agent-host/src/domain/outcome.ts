import {
  GATEWAY_REFUSALS,
  type GrantStatus,
  type OutcomeResult,
  type RunFailure,
} from '@redline/agent-protocol';
import type { SessionEnd, StopReason } from './session';

/** What the workspace holds once the session is over. */
export type WorkspaceChange = { readonly head: string } | null;

const failed = (reason: RunFailure, detail: string): OutcomeResult => ({
  kind: 'failed',
  reason,
  detail,
});

/** A model request the gateway refused, read from its account of the grant. */
const refused = (status: Extract<GrantStatus, { state: 'refused' }>): OutcomeResult => {
  switch (status.refusal) {
    case GATEWAY_REFUSALS.budgetExhausted:
      return failed('budget-exhausted', 'The task spent its budget');
    case GATEWAY_REFUSALS.credentialMissing:
      return { kind: 'credential-missing' };
    case GATEWAY_REFUSALS.credentialRefused:
      return failed('model-access-failed', 'The model refused the task’s credential');
    case GATEWAY_REFUSALS.quotaExhausted:
      return status.resetAt === null
        ? failed('infra', 'The subscription’s limit ran out without a reset time')
        : { kind: 'quota-exhausted', resetAt: status.resetAt };
    case GATEWAY_REFUSALS.grantRevoked:
      return failed('infra', 'The run’s grant was revoked');
    case GATEWAY_REFUSALS.requestRefused:
      return failed('agent-failed', 'The agent asked the model for something a run may not use');
  }
};

/** What a run concludes: its result, and whether its session is kept for a later run. */
export interface Conclusion {
  readonly result: OutcomeResult;
  /**
   * The run paused: it waits for an answer, for the subscription's limit to reset, or for the
   * requester's credential, and a later run goes on with its session.
   */
  readonly pauses: boolean;
}

/**
 * Concludes a run from how its session ended, what is left in the workspace, why agent-host
 * stopped the session (if it did) and, after a failed model request, the gateway's account of
 * why. A change exists only when the agent reported one and the tree differs from the base; the
 * agent's word alone is not a change, and edits it left behind while reporting none are not one
 * either.
 */
export const decideOutcome = (input: {
  readonly end: SessionEnd;
  readonly change: WorkspaceChange;
  readonly gateway: GrantStatus | null;
  readonly stopped: StopReason | null;
}): Conclusion => {
  const result = resultOf(input);
  return {
    result,
    pauses:
      result.kind === 'question' ||
      result.kind === 'quota-exhausted' ||
      result.kind === 'credential-missing',
  };
};

const resultOf = ({
  end,
  change,
  gateway,
  stopped,
}: Parameters<typeof decideOutcome>[0]): OutcomeResult => {
  switch (end.kind) {
    case 'completed': {
      const { report } = end;
      if (report === null) return failed('agent-failed', 'The agent ended without a usable report');
      if (report.outcome === 'no-change')
        return { kind: 'no-change', explanation: report.explanation };
      return change === null
        ? {
            kind: 'no-change',
            explanation:
              `The agent reported a change but left the code as it was. ${report.summary}`.trim(),
          }
        : { kind: 'change', head: change.head, report };
    }
    case 'asked':
      return end.question === null
        ? failed('agent-failed', 'The agent asked a question that cannot be shown to the requester')
        : { kind: 'question', question: end.question };
    case 'api-error':
      if (gateway === null) {
        // Why is not known: the gateway may have refused the run in a way it waits out (the
        // subscription's limit, a credential), so the run may go again.
        return failed(
          'infra',
          `A model request failed, and the gateway could not say why: ${end.detail}`,
        );
      }
      if (gateway.state === 'refused') return refused(gateway);
      // The gateway did not refuse it: the model or the network failed.
      return failed(
        end.status !== null && end.status >= 500 ? 'infra' : 'agent-failed',
        `A model request failed${end.status === null ? '' : ` (${String(end.status)})`}: ${end.detail}`,
      );
    case 'budget':
      return failed('budget-exhausted', 'The run reached its estimated budget');
    case 'max-turns':
      return failed('agent-failed', 'The agent used all its turns without finishing');
    case 'stopped':
      return failed(
        'agent-failed',
        stopped === 'stalled' ? 'The agent stopped responding' : 'The run took longer than allowed',
      );
    case 'error':
      return failed('infra', end.detail);
  }
};
