import * as z from 'zod/mini';
import { appError, type AppError } from '../shared/errors';
import { idSchema } from '../shared/ids';
import { err, ok, type Result } from '../shared/result';

export const TaskId = idSchema().brand<'TaskId'>();
export type TaskId = z.infer<typeof TaskId>;
export const StepId = idSchema().brand<'StepId'>();
export type StepId = z.infer<typeof StepId>;
/** Id of the context collected for a step, stored separately from the draft. */
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

/**
 * What the user is still writing: an ordered list of steps that will become one request to
 * the agent. Immutable; every operation returns a new draft. `revision` grows only when the
 * content (title, steps) changes, so a revision identifies exactly one content and assembled
 * bundles are keyed by it.
 */
export const draftSchema = z.readonly(
  z.object({
    id: TaskId,
    /** Set by the user; `null` means the UI derives a title from the steps. */
    title: z.nullable(z.string().check(z.minLength(1), z.maxLength(MAX_TITLE_LENGTH))),
    steps: z.readonly(z.array(stepSchema)),
    revision: z.int().check(z.nonnegative()),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
);
export type Draft = z.infer<typeof draftSchema>;

/** What a task asks for, whether it is still a draft or already sent: what gets assembled. */
export type TaskContent = Pick<Draft, 'id' | 'title' | 'steps'>;

export const createDraft = (id: TaskId, now: number): Draft => ({
  id,
  title: null,
  steps: [],
  revision: 0,
  createdAt: now,
  updatedAt: now,
});

const changed = (
  draft: Draft,
  change: Partial<Pick<Draft, 'title' | 'steps'>>,
  now: number,
): Draft => ({
  ...draft,
  ...change,
  revision: draft.revision + 1,
  updatedAt: now,
});

const indexOfStep = (draft: Draft, stepId: StepId): Result<number, AppError> => {
  const index = draft.steps.findIndex((step) => step.id === stepId);
  return index === -1
    ? err(appError('not-found', 'Step not found', { taskId: draft.id, stepId }))
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

export const addStep = (draft: Draft, step: Step, now: number): Result<Draft, AppError> => {
  if (draft.steps.some((existing) => existing.id === step.id)) {
    return err(appError('conflict', 'The step is already in the draft', { stepId: step.id }));
  }
  const comment = normalizeComment(step.comment);
  if (!comment.ok) return comment;
  return ok(changed(draft, { steps: [...draft.steps, { ...step, comment: comment.value }] }, now));
};

export const editStepComment = (
  draft: Draft,
  stepId: StepId,
  comment: string,
  now: number,
): Result<Draft, AppError> => {
  const index = indexOfStep(draft, stepId);
  if (!index.ok) return index;
  const normalized = normalizeComment(comment);
  if (!normalized.ok) return normalized;
  const steps = draft.steps.map((step, i) =>
    i === index.value ? { ...step, comment: normalized.value } : step,
  );
  return ok(changed(draft, { steps }, now));
};

export const removeStep = (
  draft: Draft,
  stepId: StepId,
  now: number,
): Result<{ readonly draft: Draft; readonly removed: Step }, AppError> => {
  const index = indexOfStep(draft, stepId);
  if (!index.ok) return index;
  const removed = draft.steps[index.value];
  if (removed === undefined) return err(appError('internal', 'Step index out of range'));
  const steps = draft.steps.filter((_, i) => i !== index.value);
  return ok({ draft: changed(draft, { steps }, now), removed });
};

/** Moves a step to `toIndex` (its position after the move). */
export const moveStep = (
  draft: Draft,
  stepId: StepId,
  toIndex: number,
  now: number,
): Result<Draft, AppError> => {
  const from = indexOfStep(draft, stepId);
  if (!from.ok) return from;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= draft.steps.length) {
    return err(appError('validation', 'Target position is out of range', { toIndex }));
  }
  if (toIndex === from.value) return ok(draft);
  const steps = [...draft.steps];
  const [moved] = steps.splice(from.value, 1);
  if (moved === undefined) return err(appError('internal', 'Step index out of range'));
  steps.splice(toIndex, 0, moved);
  return ok(changed(draft, { steps }, now));
};

/** Sets the user's title; an empty title clears it. */
export const renameDraft = (draft: Draft, title: string, now: number): Result<Draft, AppError> => {
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
  return next === draft.title ? ok(draft) : ok(changed(draft, { title: next }, now));
};
