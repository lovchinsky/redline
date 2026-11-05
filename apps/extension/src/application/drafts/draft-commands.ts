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
import type { TaskWriter } from '../tasks/task-writer';
import type { StoredCaptures } from './stored-captures';

export interface DraftCommandDeps {
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly bundles: BundleRepository;
  readonly captures: StoredCaptures;
  readonly writer: TaskWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type Done = Result<Record<string, never>, AppError>;
const done = (): Done => ok({});

/** Starts an empty draft and makes it the one new steps go to. */
export class CreateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(): Promise<Result<{ taskId: TaskId }, AppError>> {
    const { active, writer, ids, clock } = this.deps;
    return writer.run(async (tx) => {
      const task = createDraft(TaskId.parse(ids.next()), clock.now());
      const activated = await active.set(task.id);
      if (!activated.ok) return activated;
      const saved = await tx.commit(null, task);
      return saved.ok ? ok({ taskId: task.id }) : saved;
    });
  }
}

/** Makes an existing draft the one new steps go to. */
export class ActivateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, active, writer } = this.deps;
    return writer.run(async (tx) => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const activated = await active.set(taskId);
      if (!activated.ok) return activated;
      tx.touch(task.value);
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

  async execute(taskId: TaskId, edit: DraftEdit): Promise<Done> {
    const { writer, clock } = this.deps;
    const updated = await writer.update(taskId, (task) => apply(task, edit, clock.now()));
    return updated.ok ? done() : updated;
  }
}

/** Removes a step and deletes the context collected for it. */
export class RemoveStep {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId, stepId: StepId): Promise<Done> {
    const { tasks, captures, writer, clock } = this.deps;
    return writer.run(async (tx) => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const removed = removeStep(task.value, stepId, clock.now());
      if (!removed.ok) return removed;
      const saved = await tx.commit(task.value, removed.value.task);
      if (!saved.ok) return saved;
      await captures.dispose([removed.value.removed.captureId]);
      return done();
    });
  }
}

/**
 * Deletes a task in any state with everything collected for it. A task already delivered
 * keeps going on the receiver; the extension only stops following it.
 */
export class DeleteTask {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, active, bundles, captures, writer } = this.deps;
    return writer.run(async (tx) => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const current = await active.get();
      if (current.ok && current.value === taskId) {
        const cleared = await active.set(null);
        if (!cleared.ok) return cleared;
      }
      const deleted = await tx.commit(task.value, null);
      if (!deleted.ok) return deleted;
      const bundle = await bundles.delete(taskId);
      if (!bundle.ok) return bundle;
      await captures.dispose(task.value.steps.map((step) => step.captureId));
      return done();
    });
  }
}
