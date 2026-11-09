import type { AskedQuestion } from './exchange';
import type { GatewayRefusal } from './grant';
import type { Instant, RunId, TaskId } from './ids';
import type { AgentReport, ChangeRef, Snapshot } from './work';

/** Why a run ended without a result to act on. */
export type RunFailureReason =
  /** The sandbox, the gateway or the receiver failed: the task may run again. */
  | 'infra'
  | 'setup-failed'
  | 'repository-unavailable'
  | 'budget-exhausted'
  | 'agent-failed'
  | 'model-access-failed';

/** How a run ended, as the agent runner reports it. */
export type RunOutcome =
  | {
      readonly kind: 'question';
      readonly question: AskedQuestion;
      readonly snapshot: Snapshot | null;
    }
  | { readonly kind: 'change'; readonly change: ChangeRef; readonly report: AgentReport }
  | { readonly kind: 'no-change'; readonly explanation: string }
  /** The subscription's session or weekly limit ran out; it resets at `resetAt`. */
  | {
      readonly kind: 'quota-exhausted';
      readonly resetAt: Instant;
      readonly snapshot: Snapshot | null;
    }
  /** The requester's model credential is not in the gateway: the task waits for it to come. */
  | { readonly kind: 'credential-missing'; readonly snapshot: Snapshot | null }
  | {
      readonly kind: 'failed';
      readonly reason: RunFailureReason;
      readonly detail: string;
      readonly snapshot: Snapshot | null;
    };

/**
 * How a run begins: from scratch (`start`), with the task's paused session (`resume`), or over
 * again, told the exchanges so far because no session is there to go on with (`replay`).
 */
export type RunKind = 'start' | 'resume' | 'replay';

/**
 * One execution of the agent for a task: what it ran and when. Recorded before its sandbox
 * exists, so a worker that restarts can tell a run it started from one it did not. Whether the
 * run is still wanted is the task's to say: the run ends when the task stops running it, and
 * how it ended is in the task's history.
 */
export interface Run {
  readonly id: RunId;
  readonly taskId: TaskId;
  readonly kind: RunKind;
  readonly image: string;
  readonly model: string;
  readonly startedAt: Instant;
  /** When the task stopped running it; null while it is the task's current run. */
  readonly endedAt: Instant | null;
}

export const startRun = (input: Omit<Run, 'endedAt'>): Run => ({ ...input, endedAt: null });

export const endRun = (run: Run, at: Instant): Run => ({ ...run, endedAt: at });

/**
 * A run's outcome as far as the receiver can stand by it. The outcome is the sandbox's own
 * account, and the agent had a shell there: the outcomes that put a task back in the queue
 * without spending an attempt stand only where the gateway's refusal of the run bears them out,
 * and then at the gateway's word (its reset time). Any other account the run gives only ends the
 * task or spends its attempts, which an agent can do by failing anyway.
 */
export const corroborate = (outcome: RunOutcome, refusal: GatewayRefusal | null): RunOutcome => {
  const unconfirmed = (claim: string): RunOutcome => ({
    kind: 'failed',
    reason: 'agent-failed',
    detail: `The run said ${claim}, but the gateway did not refuse it so`,
    snapshot: null,
  });
  if (outcome.kind === 'quota-exhausted') {
    return refusal?.kind === 'quota-exhausted'
      ? { ...outcome, resetAt: refusal.resetAt }
      : unconfirmed('the subscription’s limit ran out');
  }
  if (outcome.kind === 'credential-missing') {
    return refusal?.kind === 'credential-missing'
      ? outcome
      : unconfirmed('the requester’s credential was missing');
  }
  return outcome;
};
