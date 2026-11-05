import * as z from 'zod/mini';
import { appError, type AppError } from '../shared/errors';
import { idSchema } from '../shared/ids';
import { err, ok, type Result } from '../shared/result';
import { intentSchema } from './intent';

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
    intent: intentSchema,
    comment: z.string().check(z.minLength(1), z.maxLength(MAX_COMMENT_LENGTH)),
    shapeIds: z.readonly(z.array(idSchema()).check(z.minLength(1))),
    captureId: CaptureId,
    capturedAt: z.number(),
  }),
);
export type Step = z.infer<typeof stepSchema>;

/**
 * Lifecycle of a task. Delivery states join the union when tasks can be submitted; from then
 * on the operations below must refuse to edit anything but a draft.
 */
export const taskStateSchema = z.discriminatedUnion('kind', [
  z.readonly(z.object({ kind: z.literal('draft') })),
]);
export type TaskState = z.infer<typeof taskStateSchema>;

/**
 * Aggregate root: an ordered list of steps that will become one request to the agent.
 * Immutable; every operation below returns a new task with `revision` incremented, so a
 * revision identifies exactly one content of the task (assembled bundles are keyed by it).
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

const indexOfStep = (task: Task, stepId: StepId): Result<number, AppError> => {
  const index = task.steps.findIndex((step) => step.id === stepId);
  return index === -1
    ? err(appError('not-found', 'Step not found', { taskId: task.id, stepId }))
    : ok(index);
};

const normalizeComment = (comment: string): Result<string, AppError> => {
  const trimmed = comment.trim();
  if (trimmed.length === 0) return err(appError('validation', 'A step needs a comment'));
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return err(appError('validation', 'The comment is too long', { max: MAX_COMMENT_LENGTH }));
  }
  return ok(trimmed);
};

export const addStep = (task: Task, step: Step, now: number): Result<Task, AppError> => {
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
  const trimmed = title.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return err(appError('validation', 'The title is too long', { max: MAX_TITLE_LENGTH }));
  }
  const next = trimmed.length === 0 ? null : trimmed;
  return next === task.title ? ok(task) : ok(changed(task, { title: next }, now));
};
