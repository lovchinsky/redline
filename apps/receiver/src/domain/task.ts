import type { CredentialSource } from './grant';
import { lastExchange, openExchange, settleLast, type Answer, type Exchange } from './exchange';
import { failure, type Failure, type FailureCode } from './failure';
import type { BlobDigest, Instant, ProjectId, QuestionId, RunId, TaskId, UserId } from './ids';
import { retryDelay, type TaskPolicy } from './policy';
import { err, ok, type Result } from './result';
import type { RunFailureReason, RunOutcome } from './run';
import type { AgentReport, ChangeRef, ChangeRequestRef, Snapshot } from './work';

/** The bundle a task was submitted with. Its files live in the blob store, by their hashes. */
export interface BundleRef {
  /** Digest of `manifest.json` as received: every other file is listed in it. */
  readonly manifest: BlobDigest;
  /** A short title for people: the first step's comment, shortened. */
  readonly title: string;
}

export type TaskState =
  /** Waiting for a run: the first one, or one that goes on from `resumeFrom` (null: from scratch). */
  | { readonly kind: 'queued'; readonly resumeFrom: Snapshot | null }
  | { readonly kind: 'running'; readonly runId: RunId; readonly resumedFrom: Snapshot | null }
  /** The agent asked; the session waits in `snapshot` (null: it will be replayed). */
  | {
      readonly kind: 'awaiting-reply';
      readonly questionId: QuestionId;
      readonly snapshot: Snapshot | null;
    }
  | { readonly kind: 'publishing'; readonly change: ChangeRef; readonly report: AgentReport }
  | { readonly kind: 'published'; readonly changeRequest: ChangeRequestRef }
  | { readonly kind: 'failed'; readonly failure: Failure }
  | { readonly kind: 'cancelled'; readonly reason: string };

/**
 * A request to change a project, from submission to its change request or to why there is none.
 * Every invariant of the request lives here; storage, agents and git hosts are outside.
 */
export interface Task {
  readonly id: TaskId;
  readonly requester: UserId;
  readonly projectId: ProjectId;
  readonly bundle: BundleRef;
  /**
   * Whose model credential the task runs with: the requester's own, brought with every request
   * of the extension, or the operator's. Fixed at submission, so a task never changes who pays.
   */
  readonly credentials: CredentialSource;
  /** The commit every run of this task works on, fixed by its first run. */
  readonly baseSha: string | null;
  readonly state: TaskState;
  readonly exchanges: readonly Exchange[];
  /** Runs lost to infrastructure failures. */
  readonly runAttempts: number;
  /** Failed attempts to publish the change. */
  readonly publishAttempts: number;
  /** The stored version this task was read at; the repository advances it on every save. */
  readonly version: number;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** What the application does after a transition, in the same unit of work. */
export type TaskEffect =
  | { readonly kind: 'schedule-run'; readonly at: Instant | null }
  | { readonly kind: 'schedule-publish'; readonly at: Instant | null }
  | {
      readonly kind: 'schedule-reply-timeout';
      readonly questionId: QuestionId;
      readonly at: Instant;
    }
  | { readonly kind: 'abort-run'; readonly runId: RunId }
  /** Close the change request a cancelled publication may already have opened. */
  | { readonly kind: 'withdraw-change' };

/** What happened to a task, for its history. */
export type TaskEvent = { readonly at: Instant } & (
  | { readonly type: 'submitted' }
  | { readonly type: 'run-started'; readonly runId: RunId; readonly resumed: boolean }
  | { readonly type: 'base-fixed'; readonly runId: RunId; readonly baseSha: string }
  | { readonly type: 'question-asked'; readonly questionId: QuestionId }
  | {
      readonly type: 'answered';
      readonly questionId: QuestionId;
      readonly source: Answer['source'];
    }
  | { readonly type: 'change-proposed'; readonly runId: RunId }
  | {
      readonly type: 'requeued';
      readonly runId: RunId;
      readonly reason: 'infra' | 'quota' | 'credential';
      readonly detail: string;
    }
  | { readonly type: 'publish-deferred'; readonly attempt: number; readonly detail: string }
  | { readonly type: 'published'; readonly url: string }
  | { readonly type: 'failed'; readonly code: FailureCode }
  | { readonly type: 'cancelled'; readonly reason: string }
);

export interface Transition {
  readonly task: Task;
  readonly effects: readonly TaskEffect[];
  /** Null when nothing happened: a repeat of something already done. */
  readonly event: TaskEvent | null;
}

/** A transition the task's state does not allow. */
export interface TaskConflict {
  readonly code: 'conflict';
  readonly message: string;
}

export type TransitionResult = Result<Transition, TaskConflict>;

const conflict = (message: string): TransitionResult => err({ code: 'conflict', message });

const unchanged = (task: Task): TransitionResult => ok({ task, effects: [], event: null });

const move = (
  task: Task,
  changes: Partial<
    Omit<Task, 'id' | 'requester' | 'projectId' | 'bundle' | 'credentials' | 'createdAt'>
  >,
  event: TaskEvent,
  effects: readonly TaskEffect[] = [],
): TransitionResult => ok({ task: { ...task, ...changes, updatedAt: event.at }, effects, event });

const fail = (task: Task, code: FailureCode, detail: string, now: Instant): TransitionResult =>
  move(
    task,
    { state: { kind: 'failed', failure: failure(code, detail) } },
    { type: 'failed', code, at: now },
  );

export const TERMINAL_STATES: readonly TaskState['kind'][] = ['published', 'failed', 'cancelled'];

export const isTerminal = (task: Task): boolean => TERMINAL_STATES.includes(task.state.kind);

export const isCurrentRun = (task: Task, runId: RunId): boolean =>
  task.state.kind === 'running' && task.state.runId === runId;

/** Questions the agent may still ask in this task. */
export const questionsLeft = (task: Task, policy: TaskPolicy): number =>
  Math.max(0, policy.maxQuestions - task.exchanges.length);

export interface Submission {
  readonly id: TaskId;
  readonly requester: UserId;
  readonly projectId: ProjectId;
  readonly bundle: BundleRef;
  readonly credentials: CredentialSource;
}

export const submitTask = (submission: Submission, now: Instant): Transition => ({
  task: {
    ...submission,
    baseSha: null,
    state: { kind: 'queued', resumeFrom: null },
    exchanges: [],
    runAttempts: 0,
    publishAttempts: 0,
    version: 0,
    createdAt: now,
    updatedAt: now,
  },
  effects: [{ kind: 'schedule-run', at: null }],
  event: { type: 'submitted', at: now },
});

/**
 * A run starts on a queued task, recorded before anything is prepared for it. It goes on with
 * the task's paused session when `resumable` is that session (the runner can resume it);
 * otherwise it starts over, told the exchanges so far.
 */
export const beginRun = (
  task: Task,
  runId: RunId,
  resumable: Snapshot | null,
  now: Instant,
): TransitionResult => {
  if (task.state.kind !== 'queued') return conflict(`A ${task.state.kind} task cannot start a run`);
  const paused = task.state.resumeFrom;
  const resumedFrom = paused !== null && paused.blob === resumable?.blob ? paused : null;
  return move(
    task,
    { state: { kind: 'running', runId, resumedFrom } },
    { type: 'run-started', runId, resumed: resumedFrom !== null, at: now },
  );
};

/**
 * The first run fixes the commit every run of the task works on; a later run keeps it, so a
 * resumed session works on the tree it left. Fixing it again is a no-op.
 */
export const fixBase = (
  task: Task,
  runId: RunId,
  baseSha: string,
  now: Instant,
): TransitionResult => {
  if (!isCurrentRun(task, runId)) return conflict('The run is not the current run of the task');
  if (task.baseSha !== null) return unchanged(task);
  return move(task, { baseSha }, { type: 'base-fixed', runId, baseSha, at: now });
};

const FAILURE_OF_RUN: Record<
  Exclude<RunFailureReason, 'infra' | 'credential-missing'>,
  FailureCode
> = {
  'setup-failed': 'setup-failed',
  'repository-unavailable': 'repository-unavailable',
  'budget-exhausted': 'budget-exhausted',
  'agent-failed': 'agent-failed',
  'model-access-failed': 'model-access-failed',
};

/**
 * The outcome of the task's current run. An outcome of any other run is a conflict: that run was
 * superseded (the task was cancelled, or the run was declared lost and replaced) and must not
 * move the task.
 */
export const applyOutcome = (
  task: Task,
  runId: RunId,
  outcome: RunOutcome,
  policy: TaskPolicy,
  now: Instant,
): TransitionResult => {
  if (task.state.kind !== 'running' || task.state.runId !== runId) {
    return conflict('The run is not the current run of the task');
  }
  const { resumedFrom } = task.state;
  switch (outcome.kind) {
    case 'question': {
      if (questionsLeft(task, policy) === 0) {
        return fail(task, 'agent-failed', 'it asked more questions than the project allows', now);
      }
      const exchange: Exchange = { question: outcome.question, askedAt: now, answer: null };
      return move(
        task,
        {
          state: {
            kind: 'awaiting-reply',
            questionId: outcome.question.id,
            snapshot: outcome.snapshot,
          },
          exchanges: [...task.exchanges, exchange],
        },
        { type: 'question-asked', questionId: outcome.question.id, at: now },
        [
          {
            kind: 'schedule-reply-timeout',
            questionId: outcome.question.id,
            at: now + policy.replyTimeoutMs,
          },
        ],
      );
    }
    case 'change':
      return move(
        task,
        {
          state: { kind: 'publishing', change: outcome.change, report: outcome.report },
          publishAttempts: 0,
        },
        { type: 'change-proposed', runId, at: now },
        [{ kind: 'schedule-publish', at: null }],
      );
    case 'no-change':
      return fail(task, 'no-change', outcome.explanation, now);
    case 'quota-exhausted':
      return move(
        task,
        { state: { kind: 'queued', resumeFrom: outcome.snapshot ?? resumedFrom } },
        { type: 'requeued', runId, reason: 'quota', detail: 'subscription limit reached', at: now },
        [{ kind: 'schedule-run', at: outcome.resetAt }],
      );
    case 'failed':
      return runFailed(
        task,
        runId,
        outcome.reason,
        outcome.detail,
        outcome.snapshot ?? resumedFrom,
        policy,
        now,
      );
  }
};

const runFailed = (
  task: Task,
  runId: RunId,
  reason: RunFailureReason,
  detail: string,
  resumeFrom: Snapshot | null,
  policy: TaskPolicy,
  now: Instant,
): TransitionResult => {
  switch (reason) {
    case 'infra': {
      const attempts = task.runAttempts + 1;
      if (attempts >= policy.maxRunAttempts) {
        return fail(
          task,
          'agent-failed',
          `the infrastructure failed ${String(attempts)} times (${detail})`,
          now,
        );
      }
      return move(
        task,
        { state: { kind: 'queued', resumeFrom }, runAttempts: attempts },
        { type: 'requeued', runId, reason: 'infra', detail, at: now },
        [{ kind: 'schedule-run', at: now + retryDelay(policy, attempts) }],
      );
    }
    case 'credential-missing':
      // Nothing to schedule: the next request of the extension brings the credential back and
      // schedules the run.
      return move(
        task,
        { state: { kind: 'queued', resumeFrom } },
        { type: 'requeued', runId, reason: 'credential', detail, at: now },
      );
    default:
      return fail(task, FAILURE_OF_RUN[reason], detail, now);
  }
};

/** The current run's sandbox disappeared without an outcome. */
export const loseRun = (
  task: Task,
  runId: RunId,
  detail: string,
  policy: TaskPolicy,
  now: Instant,
): TransitionResult =>
  applyOutcome(
    task,
    runId,
    { kind: 'failed', reason: 'infra', detail, snapshot: null },
    policy,
    now,
  );

/**
 * The requester answers a question. Answering the same question with the same text again
 * changes nothing (its response may have been lost). An answer that arrives after the question
 * timed out still counts while the run that goes on without it has not started.
 */
export const answerQuestion = (
  task: Task,
  questionId: QuestionId,
  text: string,
  now: Instant,
): TransitionResult => {
  const answer: Answer = { source: 'requester', text, at: now };
  const answered = task.exchanges.find((exchange) => exchange.question.id === questionId);
  if (answered?.answer?.source === 'requester') {
    return answered.answer.text === text
      ? unchanged(task)
      : conflict('The question is already answered');
  }
  const { state } = task;
  if (state.kind === 'awaiting-reply' && state.questionId === questionId) {
    return move(
      task,
      {
        state: { kind: 'queued', resumeFrom: state.snapshot },
        exchanges: settleLast(task.exchanges, answer),
      },
      { type: 'answered', questionId, source: 'requester', at: now },
      [{ kind: 'schedule-run', at: null }],
    );
  }
  const last = lastExchange(task.exchanges);
  if (
    state.kind === 'queued' &&
    last?.question.id === questionId &&
    last.answer?.source === 'timeout'
  ) {
    return move(
      task,
      { exchanges: settleLast(task.exchanges, answer) },
      { type: 'answered', questionId, source: 'requester', at: now },
    );
  }
  return conflict('There is no open question with this id');
};

/**
 * A question's time ran out. If it is still open, the agent goes on with its own judgement or
 * the task fails, as the project chooses; if it was answered meanwhile, nothing happens.
 */
export const expireQuestion = (
  task: Task,
  questionId: QuestionId,
  policy: TaskPolicy,
  now: Instant,
): TransitionResult => {
  const { state } = task;
  if (state.kind !== 'awaiting-reply' || state.questionId !== questionId) return unchanged(task);
  if (openExchange(task.exchanges)?.question.id !== questionId) return unchanged(task);
  if (policy.onReplyTimeout === 'fail') return fail(task, 'no-reply', '', now);
  return move(
    task,
    {
      state: { kind: 'queued', resumeFrom: state.snapshot },
      exchanges: settleLast(task.exchanges, { source: 'timeout', at: now }),
    },
    { type: 'answered', questionId, source: 'timeout', at: now },
    [{ kind: 'schedule-run', at: null }],
  );
};

export const markPublished = (
  task: Task,
  changeRequest: ChangeRequestRef,
  now: Instant,
): TransitionResult => {
  if (task.state.kind !== 'publishing')
    return conflict(`A ${task.state.kind} task cannot be published`);
  return move(
    task,
    { state: { kind: 'published', changeRequest } },
    { type: 'published', url: changeRequest.url, at: now },
  );
};

/** Publishing failed: a transient failure is retried until the attempts run out. */
export const recordPublishFailure = (
  task: Task,
  failureOf: { readonly transient: boolean; readonly detail: string },
  policy: TaskPolicy,
  now: Instant,
): TransitionResult => {
  if (task.state.kind !== 'publishing')
    return conflict(`A ${task.state.kind} task is not publishing`);
  const attempts = task.publishAttempts + 1;
  if (!failureOf.transient || attempts >= policy.maxPublishAttempts) {
    return fail({ ...task, publishAttempts: attempts }, 'publish-failed', failureOf.detail, now);
  }
  return move(
    task,
    { publishAttempts: attempts },
    { type: 'publish-deferred', attempt: attempts, detail: failureOf.detail, at: now },
    [{ kind: 'schedule-publish', at: now + retryDelay(policy, attempts) }],
  );
};

export const rejectByPolicy = (task: Task, summary: string, now: Instant): TransitionResult => {
  if (task.state.kind !== 'publishing')
    return conflict(`A ${task.state.kind} task is not publishing`);
  return fail(task, 'policy-rejected', summary, now);
};

/** The operator cancels a task. Cancelling a cancelled task changes nothing. */
export const cancelTask = (task: Task, reason: string, now: Instant): TransitionResult => {
  const event: TaskEvent = { type: 'cancelled', reason, at: now };
  const cancelled = { state: { kind: 'cancelled', reason } } as const;
  switch (task.state.kind) {
    case 'queued':
    case 'awaiting-reply':
      return move(task, cancelled, event);
    case 'running':
      return move(task, cancelled, event, [{ kind: 'abort-run', runId: task.state.runId }]);
    case 'publishing':
      return move(task, cancelled, event, [{ kind: 'withdraw-change' }]);
    case 'cancelled':
      return unchanged(task);
    case 'published':
    case 'failed':
      return conflict(`A ${task.state.kind} task cannot be cancelled`);
  }
};
