import {
  TaskId,
  createDraft,
  editStepComment,
  moveStep,
  ok,
  removeStep,
  renameTask,
  type AppError,
  type Clock,
  type IdGenerator,
  type Result,
  type StepId,
  type Task,
} from '@redline/core';
import type { ActiveDraftStore, BundleRepository, TaskRepository } from '../../ports/drafts';
import type { DraftWriter } from './draft-writer';
import type { StoredCaptures } from './stored-captures';

export interface DraftCommandDeps {
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly bundles: BundleRepository;
  readonly captures: StoredCaptures;
  readonly writer: DraftWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type Done = Result<Record<string, never>, AppError>;
const done = (): Done => ok({});

/** Starts an empty draft and makes it the one new steps go to. */
export class CreateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(): Promise<Result<{ taskId: TaskId }, AppError>> {
    const { tasks, active, writer, ids, clock } = this.deps;
    return writer.run(async () => {
      const task = createDraft(TaskId.parse(ids.next()), clock.now());
      const saved = await tasks.save(task);
      if (!saved.ok) return saved;
      const activated = await active.set(task.id);
      if (!activated.ok) return activated;
      await writer.announce(task.id);
      return ok({ taskId: task.id });
    });
  }
}

/** Makes an existing draft the one new steps go to. */
export class ActivateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, active, writer } = this.deps;
    return writer.run(async () => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const activated = await active.set(taskId);
      if (!activated.ok) return activated;
      await writer.announce(taskId);
      return done();
    });
  }
}

export type DraftEdit =
  | { readonly kind: 'rename'; readonly title: string }
  | { readonly kind: 'edit-comment'; readonly stepId: StepId; readonly comment: string }
  | { readonly kind: 'move-step'; readonly stepId: StepId; readonly toIndex: number };

const apply = (task: Task, edit: DraftEdit, now: number): Result<Task, AppError> => {
  switch (edit.kind) {
    case 'rename':
      return renameTask(task, edit.title, now);
    case 'edit-comment':
      return editStepComment(task, edit.stepId, edit.comment, now);
    case 'move-step':
      return moveStep(task, edit.stepId, edit.toIndex, now);
  }
};

/** Edits that only change the task itself. */
export class EditDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId, edit: DraftEdit): Promise<Done> {
    const { tasks, writer, clock } = this.deps;
    return writer.run(async () => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const next = apply(task.value, edit, clock.now());
      if (!next.ok) return next;
      if (next.value === task.value) return done();
      const saved = await tasks.save(next.value);
      if (!saved.ok) return saved;
      await writer.announce(taskId);
      return done();
    });
  }
}

/** Removes a step and deletes the context collected for it. */
export class RemoveStep {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId, stepId: StepId): Promise<Done> {
    const { tasks, captures, writer, clock } = this.deps;
    return writer.run(async () => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const removed = removeStep(task.value, stepId, clock.now());
      if (!removed.ok) return removed;
      const saved = await tasks.save(removed.value.task);
      if (!saved.ok) return saved;
      await captures.dispose([removed.value.removed.captureId]);
      await writer.announce(taskId);
      return done();
    });
  }
}

/** Deletes a draft with everything collected for it. */
export class DeleteDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, active, bundles, captures, writer } = this.deps;
    return writer.run(async () => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const deleted = await tasks.delete(taskId);
      if (!deleted.ok) return deleted;

      const current = await active.get();
      if (current.ok && current.value === taskId) {
        const cleared = await active.set(null);
        if (!cleared.ok) return cleared;
      }
      const bundle = await bundles.delete(taskId);
      if (!bundle.ok) return bundle;
      await captures.dispose(task.value.steps.map((step) => step.captureId));
      await writer.announce(taskId);
      return done();
    });
  }
}
