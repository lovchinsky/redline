import type { Question } from './exchange';
import type { Instant, RunId, TaskId } from './ids';
import type { AgentReport, ChangeRef, Snapshot } from './work';

/** Why a run ended without a result to act on. */
export type RunFailureReason =
  /** The sandbox, the gateway or the receiver failed: the task may run again. */
  | 'infra'
  /** The requester's model credential is not in the gateway: the task waits for the extension. */
  | 'credential-missing'
  | 'setup-failed'
  | 'repository-unavailable'
  | 'budget-exhausted'
  | 'agent-failed'
  | 'model-access-failed';

/** How a run ended, as the agent runner reports it. */
export type RunOutcome =
  | { readonly kind: 'question'; readonly question: Question; readonly snapshot: Snapshot | null }
  | { readonly kind: 'change'; readonly change: ChangeRef; readonly report: AgentReport }
  | { readonly kind: 'no-change'; readonly explanation: string }
  /** The subscription's session or weekly limit ran out; it resets at `resetAt`. */
  | {
      readonly kind: 'quota-exhausted';
      readonly resetAt: Instant;
      readonly snapshot: Snapshot | null;
    }
  | {
      readonly kind: 'failed';
      readonly reason: RunFailureReason;
      readonly detail: string;
      readonly snapshot: Snapshot | null;
    };

export type RunState =
  | { readonly kind: 'started' }
  /** `applied`: whether the outcome moved the task; an outcome of a superseded run does not. */
  | {
      readonly kind: 'finished';
      readonly outcome: RunOutcome;
      readonly applied: boolean;
      readonly at: Instant;
    }
  /** The run's sandbox disappeared without an outcome. */
  | { readonly kind: 'interrupted'; readonly at: Instant };

/**
 * How a run begins: the task's first, one that goes on with a paused session, or one that
 * starts over, told the exchanges so far, because the paused session cannot be resumed.
 */
export type RunKind = 'start' | 'resume' | 'replay';

/**
 * One execution of the agent for a task. Recorded before its sandbox exists, so a supervisor
 * that crashed can tell a run it started from one it did not.
 */
export interface Run {
  readonly id: RunId;
  readonly taskId: TaskId;
  readonly kind: RunKind;
  readonly image: string;
  readonly model: string;
  readonly startedAt: Instant;
  readonly state: RunState;
}

export const startRun = (input: Omit<Run, 'state'>): Run => ({
  ...input,
  state: { kind: 'started' },
});

export const finishRun = (run: Run, outcome: RunOutcome, applied: boolean, at: Instant): Run => ({
  ...run,
  state: { kind: 'finished', outcome, applied, at },
});

export const interruptRun = (run: Run, at: Instant): Run => ({
  ...run,
  state: { kind: 'interrupted', at },
});
