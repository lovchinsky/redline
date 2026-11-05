import * as z from 'zod/mini';
import { ERROR_REASONS, appError, type AppError } from '../shared/errors';
import { idSchema } from '../shared/ids';
import { err, ok, type Result } from '../shared/result';
import { ProjectId } from './binding';
import { remoteStatusSchema } from './remote-status';

export const TaskId = idSchema().brand<'TaskId'>();
export type TaskId = z.infer<typeof TaskId>;
export const StepId = idSchema().brand<'StepId'>();
export type StepId = z.infer<typeof StepId>;
/** Id of the context collected for a step, stored separately from the task. */
export const CaptureId = idSchema().brand<'CaptureId'>();
export type CaptureId = z.infer<typeof CaptureId>;

export const MAX_COMMENT_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 120;

export const viewportSchema = z.readonly(
  z.object({
    width: z.int().check(z.positive()),
    height: z.int().check(z.positive()),
    devicePixelRatio: z.number().check(z.positive()),
    scrollX: z.number(),
    scrollY: z.number(),
  }),
);
export type Viewport = z.infer<typeof viewportSchema>;

export const pageRefSchema = z.readonly(
  z.object({ url: z.url(), routePattern: z.string(), title: z.string() }),
);
export type PageRef = z.infer<typeof pageRefSchema>;

/** One circled moment: what the user asked for on one page, with a link to its context. */
export const stepSchema = z.readonly(
  z.object({
    id: StepId,
    page: pageRefSchema,
    viewport: viewportSchema,
    comment: z.string().check(z.minLength(1), z.maxLength(MAX_COMMENT_LENGTH)),
    shapeIds: z.readonly(z.array(idSchema()).check(z.minLength(1))),
    captureId: CaptureId,
    capturedAt: z.number(),
  }),
);
export type Step = z.infer<typeof stepSchema>;

/** Why delivering or following a task failed, kept as plain data on the task. */
export const deliveryErrorSchema = z.readonly(
  z.object({
    code: z.string(),
    message: z.string(),
    /** What the user can do about it, when that is known; see `ERROR_REASONS`. */
    reason: z.optional(z.enum(ERROR_REASONS)),
  }),
);
export type DeliveryError = z.infer<typeof deliveryErrorSchema>;

export const DeliveryId = idSchema().brand<'DeliveryId'>();
export type DeliveryId = z.infer<typeof DeliveryId>;

/**
 * One send of one frozen bundle to a project. Its id is the receiver's idempotency key: every
 * attempt of the same send carries it, so a retry after a lost response finds the task the
 * first attempt created. Sending again after a definitive answer is a new delivery, with a new id.
 */
export const deliverySchema = z.readonly(
  z.object({
    id: DeliveryId,
    projectId: ProjectId,
    projectName: z.string(),
    /** Digest of the frozen bundle that is delivered, byte for byte. */
    digest: z.string(),
  }),
);
export type Delivery = z.infer<typeof deliverySchema>;

/**
 * Lifecycle of a task: a draft is edited; a queued task waits in the outbox until the receiver
 * accepts its frozen bundle; a submitted task follows the receiver's status; a failed one was
 * refused by the receiver and can be retried or reopened as a draft; a lost one was accepted,
 * but the receiver no longer knows it, so there is nothing left to follow.
 */
export const taskStateSchema = z.discriminatedUnion('kind', [
  z.readonly(z.object({ kind: z.literal('draft') })),
  z.readonly(
    z.object({
      kind: z.literal('queued'),
      delivery: deliverySchema,
      queuedAt: z.number(),
      attempts: z.int().check(z.nonnegative()),
      nextAttemptAt: z.number(),
      lastError: z.nullable(deliveryErrorSchema),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('submitted'),
      delivery: deliverySchema,
      remoteId: z.string().check(z.minLength(1)),
      submittedAt: z.number(),
      status: remoteStatusSchema,
      /** When the receiver last reported, and how often it is willing to be asked. */
      checkedAt: z.number(),
      pollAfterSec: z.number().check(z.positive()),
      /** When to ask the receiver again on schedule; `null` once the status is terminal. */
      nextCheckAt: z.nullable(z.number()),
      /** Checks failed in a row since the last report, and why the latest one did. */
      checkFailures: z.int().check(z.nonnegative()),
      checkError: z.nullable(deliveryErrorSchema),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('failed'),
      delivery: deliverySchema,
      error: deliveryErrorSchema,
      failedAt: z.number(),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('lost'),
      delivery: deliverySchema,
      remoteId: z.string().check(z.minLength(1)),
      submittedAt: z.number(),
      lostAt: z.number(),
    }),
  ),
]);
export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskStateKind = TaskState['kind'];

/**
 * Aggregate root: an ordered list of steps that will become one request to the agent.
 * Immutable; every operation returns a new task. `revision` grows only when the content
 * (title, steps) changes, so a revision identifies exactly one content of the task and
 * assembled bundles are keyed by it. State changes only move `updatedAt`.
 */
export const taskSchema = z.readonly(
  z.object({
    id: TaskId,
    /** Set by the user; `null` means the UI derives a title from the steps. */
    title: z.nullable(z.string().check(z.minLength(1), z.maxLength(MAX_TITLE_LENGTH))),
    state: taskStateSchema,
    steps: z.readonly(z.array(stepSchema)),
    revision: z.int().check(z.nonnegative()),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
);
export type Task = z.infer<typeof taskSchema>;

export const createDraft = (id: TaskId, now: number): Task => ({
  id,
  title: null,
  state: { kind: 'draft' },
  steps: [],
  revision: 0,
  createdAt: now,
  updatedAt: now,
});

const changed = (
  task: Task,
  change: Partial<Pick<Task, 'title' | 'steps'>>,
  now: number,
): Task => ({
  ...task,
  ...change,
  revision: task.revision + 1,
  updatedAt: now,
});

const requireDraft = (task: Task): Result<Task, AppError> =>
  task.state.kind === 'draft'
    ? ok(task)
    : err(appError('conflict', 'Only a draft can be edited', { state: task.state.kind }));

const indexOfStep = (task: Task, stepId: StepId): Result<number, AppError> => {
  const index = task.steps.findIndex((step) => step.id === stepId);
  return index === -1
    ? err(appError('not-found', 'Step not found', { taskId: task.id, stepId }))
    : ok(index);
};

const normalizeComment = (comment: string): Result<string, AppError> => {
  const trimmed = comment.trim();
  if (trimmed.length === 0)
    return err(appError('validation', 'A step needs a comment', { reason: 'comment-required' }));
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return err(
      appError('validation', 'The comment is too long', {
        max: MAX_COMMENT_LENGTH,
        reason: 'comment-too-long',
      }),
    );
  }
  return ok(trimmed);
};

export const addStep = (task: Task, step: Step, now: number): Result<Task, AppError> => {
  const draft = requireDraft(task);
  if (!draft.ok) return draft;
  if (task.steps.some((existing) => existing.id === step.id)) {
    return err(appError('conflict', 'The step is already in the task', { stepId: step.id }));
  }
  const comment = normalizeComment(step.comment);
  if (!comment.ok) return comment;
  return ok(changed(task, { steps: [...task.steps, { ...step, comment: comment.value }] }, now));
};

export const editStepComment = (
  task: Task,
  stepId: StepId,
  comment: string,
  now: number,
): Result<Task, AppError> => {
  const draft = requireDraft(task);
  if (!draft.ok) return draft;
  const index = indexOfStep(task, stepId);
  if (!index.ok) return index;
  const normalized = normalizeComment(comment);
  if (!normalized.ok) return normalized;
  const steps = task.steps.map((step, i) =>
    i === index.value ? { ...step, comment: normalized.value } : step,
  );
  return ok(changed(task, { steps }, now));
};

export const removeStep = (
  task: Task,
  stepId: StepId,
  now: number,
): Result<{ readonly task: Task; readonly removed: Step }, AppError> => {
  const draft = requireDraft(task);
  if (!draft.ok) return draft;
  const index = indexOfStep(task, stepId);
  if (!index.ok) return index;
  const removed = task.steps[index.value];
  if (removed === undefined) return err(appError('internal', 'Step index out of range'));
  const steps = task.steps.filter((_, i) => i !== index.value);
  return ok({ task: changed(task, { steps }, now), removed });
};

/** Moves a step to `toIndex` (its position after the move). */
export const moveStep = (
  task: Task,
  stepId: StepId,
  toIndex: number,
  now: number,
): Result<Task, AppError> => {
  const draft = requireDraft(task);
  if (!draft.ok) return draft;
  const from = indexOfStep(task, stepId);
  if (!from.ok) return from;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= task.steps.length) {
    return err(appError('validation', 'Target position is out of range', { toIndex }));
  }
  if (toIndex === from.value) return ok(task);
  const steps = [...task.steps];
  const [moved] = steps.splice(from.value, 1);
  if (moved === undefined) return err(appError('internal', 'Step index out of range'));
  steps.splice(toIndex, 0, moved);
  return ok(changed(task, { steps }, now));
};

/** Sets the user's title; an empty title clears it. */
export const renameTask = (task: Task, title: string, now: number): Result<Task, AppError> => {
  const draft = requireDraft(task);
  if (!draft.ok) return draft;
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return err(
      appError('validation', 'The title is too long', {
        max: MAX_TITLE_LENGTH,
        reason: 'title-too-long',
      }),
    );
  }
  const next = trimmed.length === 0 ? null : trimmed;
  return next === task.title ? ok(task) : ok(changed(task, { title: next }, now));
};
