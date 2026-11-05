import { appError, type AppError } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';
import { isTerminal, type RemoteStatus } from './remote-status';
import type { Delivery, DeliveryError, DeliveryId, Task, TaskState, TaskStateKind } from './task';

/** Receivers may ask to be polled more often; the extension never polls faster than this. */
export const MIN_POLL_INTERVAL_SEC = 30;

/** What the receiver reported about a delivered task. */
export interface RemoteReport {
  readonly status: RemoteStatus;
  readonly pollAfterSec: number;
}

type StateOf<K extends TaskStateKind> = Extract<TaskState, { kind: K }>;

const inState = <K extends TaskStateKind>(task: Task, kind: K): Result<StateOf<K>, AppError> =>
  task.state.kind === kind
    ? ok(task.state as StateOf<K>)
    : err(
        appError('conflict', `The task is ${task.state.kind}, not ${kind}`, {
          taskId: task.id,
          state: task.state.kind,
        }),
      );

const withState = (task: Task, state: TaskState, now: number): Task => ({
  ...task,
  state,
  updatedAt: now,
});

const nextCheck = (report: RemoteReport, now: number): number | null =>
  isTerminal(report.status)
    ? null
    : now + Math.max(MIN_POLL_INTERVAL_SEC, report.pollAfterSec) * 1000;

const queuedState = (delivery: Delivery, now: number): TaskState => ({
  kind: 'queued',
  delivery,
  queuedAt: now,
  attempts: 0,
  nextAttemptAt: now,
  lastError: null,
});

/** Freezes a draft for delivery: its bundle (by digest) goes to the outbox. */
export const queueForDelivery = (
  task: Task,
  delivery: Delivery,
  now: number,
): Result<Task, AppError> => {
  const draft = inState(task, 'draft');
  if (!draft.ok) return draft;
  if (task.steps.length === 0) {
    return err(appError('validation', 'A task without steps cannot be sent'));
  }
  return ok(withState(task, queuedState(delivery, now), now));
};

/**
 * A delivery attempt starts: it is counted, and the next one is scheduled for `retryAt`, before
 * any request goes out. If the attempt never reports back (the worker stopped mid-request), the
 * task already says when to try again, so retries keep their backoff.
 */
export const startDeliveryAttempt = (
  task: Task,
  retryAt: number,
  now: number,
): Result<Task, AppError> => {
  const queued = inState(task, 'queued');
  if (!queued.ok) return queued;
  return ok(
    withState(
      task,
      { ...queued.value, attempts: queued.value.attempts + 1, nextAttemptAt: retryAt },
      now,
    ),
  );
};

/** The started attempt failed for a reason that may pass (offline, receiver down). */
export const recordFailedAttempt = (
  task: Task,
  error: DeliveryError,
  nextAttemptAt: number,
  now: number,
): Result<Task, AppError> => {
  const queued = inState(task, 'queued');
  if (!queued.ok) return queued;
  return ok(withState(task, { ...queued.value, nextAttemptAt, lastError: error }, now));
};

/** Moves the next attempt to `at`, e.g. when the user asks to retry now. */
export const rescheduleDelivery = (task: Task, at: number, now: number): Result<Task, AppError> => {
  const queued = inState(task, 'queued');
  if (!queued.ok) return queued;
  return ok(withState(task, { ...queued.value, nextAttemptAt: at }, now));
};

/** The receiver accepted the bundle. */
export const markSubmitted = (
  task: Task,
  receipt: RemoteReport & { readonly remoteId: string },
  now: number,
): Result<Task, AppError> => {
  const queued = inState(task, 'queued');
  if (!queued.ok) return queued;
  return ok(
    withState(
      task,
      {
        kind: 'submitted',
        delivery: queued.value.delivery,
        remoteId: receipt.remoteId,
        submittedAt: now,
        status: receipt.status,
        checkedAt: now,
        pollAfterSec: receipt.pollAfterSec,
        nextCheckAt: nextCheck(receipt, now),
        checkFailures: 0,
        checkError: null,
      },
      now,
    ),
  );
};

/** The receiver refused the bundle; retrying the same bundle will not help by itself. */
export const markDeliveryFailed = (
  task: Task,
  error: DeliveryError,
  now: number,
): Result<Task, AppError> => {
  const queued = inState(task, 'queued');
  if (!queued.ok) return queued;
  return ok(
    withState(
      task,
      {
        kind: 'failed',
        delivery: queued.value.delivery,
        error,
        failedAt: now,
      },
      now,
    ),
  );
};

/**
 * Sends a refused bundle again, e.g. after the user fixed the receiver settings. The receiver
 * answered the previous delivery for good, so this one is new and carries a new id.
 */
export const retryDelivery = (task: Task, id: DeliveryId, now: number): Result<Task, AppError> => {
  const failed = inState(task, 'failed');
  if (!failed.ok) return failed;
  return ok(withState(task, queuedState({ ...failed.value.delivery, id }, now), now));
};

/** Turns a refused task back into a draft so it can be edited and sent again. */
export const reopenDraft = (task: Task, now: number): Result<Task, AppError> => {
  const failed = inState(task, 'failed');
  if (!failed.ok) return failed;
  return ok(withState(task, { kind: 'draft' }, now));
};

/** Records the receiver's latest status of a submitted task. */
export const applyRemoteReport = (
  task: Task,
  report: RemoteReport,
  now: number,
): Result<Task, AppError> => {
  const submitted = inState(task, 'submitted');
  if (!submitted.ok) return submitted;
  return ok(
    withState(
      task,
      {
        ...submitted.value,
        status: report.status,
        checkedAt: now,
        pollAfterSec: report.pollAfterSec,
        nextCheckAt: nextCheck(report, now),
        checkFailures: 0,
        checkError: null,
      },
      now,
    ),
  );
};

/**
 * Asking the receiver failed for a reason that may pass; ask again at `at` without changing
 * what is known. The failure is counted, so the caller can back off.
 */
export const deferStatusCheck = (
  task: Task,
  error: DeliveryError,
  at: number,
  now: number,
): Result<Task, AppError> => {
  const submitted = inState(task, 'submitted');
  if (!submitted.ok) return submitted;
  // Nothing is scheduled after a final status, so there is nothing to defer.
  if (isTerminal(submitted.value.status)) return ok(task);
  return ok(
    withState(
      task,
      {
        ...submitted.value,
        nextCheckAt: at,
        checkFailures: submitted.value.checkFailures + 1,
        checkError: error,
      },
      now,
    ),
  );
};

/** The receiver no longer knows the task it accepted: there is nothing left to follow. */
export const loseTrack = (task: Task, now: number): Result<Task, AppError> => {
  const submitted = inState(task, 'submitted');
  if (!submitted.ok) return submitted;
  const { delivery, remoteId, submittedAt } = submitted.value;
  return ok(withState(task, { kind: 'lost', delivery, remoteId, submittedAt, lostAt: now }, now));
};

/**
 * Whether the user may ask the receiver right now. Scheduled checks keep a 30 s floor (the
 * platform's alarm limit); an explicit refresh only respects the receiver's own interval.
 */
export const mayRefresh = (task: Task, now: number): boolean =>
  task.state.kind === 'submitted' &&
  !isTerminal(task.state.status) &&
  now >= task.state.checkedAt + task.state.pollAfterSec * 1000;

/** In flight: waiting in the outbox or followed on the receiver. */
export const isActive = (task: Task): boolean =>
  task.state.kind === 'queued' ||
  (task.state.kind === 'submitted' && !isTerminal(task.state.status));

/** Nothing more will happen to it: done on the receiver, or no longer known there. */
export const isFinished = (task: Task): boolean =>
  task.state.kind === 'lost' || (task.state.kind === 'submitted' && isTerminal(task.state.status));

/** The agent is waiting for the user's answer. */
export const needsInput = (task: Task): boolean =>
  task.state.kind === 'submitted' && task.state.status.phase === 'needs-input';
