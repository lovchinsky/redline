import {
  TaskId,
  createDraft,
  editStepComment,
  moveStep,
  ok,
  removeStep,
  renameDraft,
  type AppError,
  type Clock,
  type Draft,
  type IdGenerator,
  type Result,
  type StepId,
  type Task,
} from '@redline/core';
import type { BundleRepository } from '../../ports/drafts';
import type { ActiveDraftStore, DraftRepository, TaskRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';
import type { StoredCaptures } from './stored-captures';

export interface DraftCommandDeps {
  readonly drafts: DraftRepository;
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly bundles: BundleRepository;
  readonly captures: StoredCaptures;
  readonly writer: WorkspaceWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type Done = Result<Record<string, never>, AppError>;
const done = (): Done => ok({});

/** Starts an empty draft and makes it the one new steps go to. */
export class CreateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(): Promise<Result<{ taskId: TaskId }, AppError>> {
    const { writer, ids, clock } = this.deps;
    return writer.run((tx) => {
      const draft = createDraft(TaskId.parse(ids.next()), clock.now());
      tx.saveDraft(null, draft);
      tx.setActive(draft.id);
      return Promise.resolve(ok({ taskId: draft.id }));
    });
  }
}

/** Makes an existing draft the one new steps go to. */
export class ActivateDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { drafts, writer } = this.deps;
    return writer.run(async (tx) => {
      const draft = await drafts.get(taskId);
      if (!draft.ok) return draft;
      tx.setActive(taskId);
      return done();
    });
  }
}

export type DraftEdit =
  | { readonly kind: 'rename'; readonly title: string }
  | { readonly kind: 'edit-comment'; readonly stepId: StepId; readonly comment: string }
  | { readonly kind: 'move-step'; readonly stepId: StepId; readonly toIndex: number };

const apply = (draft: Draft, edit: DraftEdit, now: number): Result<Draft, AppError> => {
  switch (edit.kind) {
    case 'rename':
      return renameDraft(draft, edit.title, now);
    case 'edit-comment':
      return editStepComment(draft, edit.stepId, edit.comment, now);
    case 'move-step':
      return moveStep(draft, edit.stepId, edit.toIndex, now);
  }
};

/** Edits that only change the draft itself. */
export class EditDraft {
  constructor(private readonly deps: DraftCommandDeps) {}

  async execute(taskId: TaskId, edit: DraftEdit): Promise<Done> {
    const { writer, clock } = this.deps;
    const updated = await writer.updateDraft(taskId, (draft) => apply(draft, edit, clock.now()));
    return updated.ok ? done() : updated;
  }
}

/** Removes a step and, once that is saved, the context collected for it. */
export class RemoveStep {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId, stepId: StepId): Promise<Done> {
    const { drafts, captures, writer, clock } = this.deps;
    return writer.run(async (tx) => {
      const draft = await drafts.get(taskId);
      if (!draft.ok) return draft;
      const removed = removeStep(draft.value, stepId, clock.now());
      if (!removed.ok) return removed;
      tx.saveDraft(draft.value, removed.value.draft);
      tx.afterCommit(() => captures.dispose([removed.value.removed.captureId]));
      return done();
    });
  }
}

/**
 * Deletes a draft, or a sent task in any state, with everything collected for it. A task
 * already delivered keeps going on the receiver; the extension only stops following it.
 */
export class DeleteTask {
  constructor(private readonly deps: DraftCommandDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { active, bundles, captures, writer } = this.deps;
    return writer.run(async (tx) => {
      const found = await this.find(taskId);
      if (!found.ok) return found;
      const { draft, task } = found.value;
      if (draft !== null) {
        tx.saveDraft(draft, null);
        const current = await active.get();
        if (current.ok && current.value === taskId) tx.setActive(null);
      }
      if (task !== null) tx.saveTask(task, null);
      const steps = (draft ?? task)?.steps ?? [];
      tx.afterCommit(async () => {
        await bundles.delete(taskId);
        await captures.dispose(steps.map((step) => step.captureId));
      });
      return done();
    });
  }

  private async find(
    taskId: TaskId,
  ): Promise<Result<{ draft: Draft | null; task: Task | null }, AppError>> {
    const draft = await this.deps.drafts.get(taskId);
    if (draft.ok) return ok({ draft: draft.value, task: null });
    if (draft.error.code !== 'not-found') return draft;
    const task = await this.deps.tasks.get(taskId);
    return task.ok ? ok({ draft: null, task: task.value }) : task;
  }
}
