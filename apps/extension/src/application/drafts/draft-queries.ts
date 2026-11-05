import {
  ok,
  sameTarget,
  type AppError,
  type AssetRef,
  type FragmentCatalog,
  type Result,
  type Step,
  type StepCapture,
  type Task,
  type TaskId,
} from '@redline/core';
import type { DraftSummary, DraftView, StepView, TaskView } from '@redline/rpc';
import { taskViewOf } from '../delivery/task-view';
import type { ActiveDraftStore, TaskRepository } from '../../ports/drafts';
import type { StoredCaptures } from './stored-captures';

export interface DraftQueryDeps {
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly captures: StoredCaptures;
  readonly catalog: FragmentCatalog;
}

const summaryOf = (task: Task): DraftSummary => ({
  id: task.id,
  title: task.title,
  firstComment: task.steps[0]?.comment ?? null,
  stepCount: task.steps.length,
  updatedAt: task.updatedAt,
});

/** Drafts, most recently changed first, and the one new steps go to. */
export class ListDrafts {
  constructor(private readonly deps: DraftQueryDeps) {}

  async execute(): Promise<
    Result<{ activeId: TaskId | null; drafts: readonly DraftSummary[] }, AppError>
  > {
    const [tasks, active] = await Promise.all([this.deps.tasks.list(), this.deps.active.get()]);
    if (!tasks.ok) return tasks;
    if (!active.ok) return active;
    const drafts = [...tasks.value].sort((a, b) => b.updatedAt - a.updatedAt).map(summaryOf);
    const activeId = drafts.some((draft) => draft.id === active.value) ? active.value : null;
    return ok({ activeId, drafts });
  }
}

/** One draft with its steps, as the side panel shows it. */
export class GetDraft {
  constructor(private readonly deps: DraftQueryDeps) {}

  async execute(taskId: TaskId): Promise<Result<DraftView, AppError>> {
    const task = await this.deps.tasks.get(taskId);
    if (!task.ok) return task;
    const steps = await Promise.all(task.value.steps.map((step) => this.viewOf(step)));
    return ok({
      id: task.value.id,
      title: task.value.title,
      revision: task.value.revision,
      updatedAt: task.value.updatedAt,
      steps,
    });
  }

  private async viewOf(step: Step): Promise<StepView> {
    const capture = await this.deps.captures.load(step.captureId);
    return {
      id: step.id,
      comment: step.comment,
      page: step.page,
      areaCount: step.shapeIds.length,
      capturedAt: step.capturedAt,
      // A step whose context cannot be read still lists; it just has no picture.
      thumbnail: capture.ok ? this.thumbnailOf(step, capture.value) : null,
    };
  }

  /** The first picture any presenter offers for the first circled area. */
  private thumbnailOf(step: Step, capture: StepCapture): AssetRef | null {
    const [firstShape] = step.shapeIds;
    for (const fragment of capture.fragments) {
      if (!sameTarget(fragment.target, { level: 'shape', shapeId: firstShape ?? '' })) continue;
      const thumbnail = this.deps.catalog.get(fragment.kind)?.presenter.thumbnail?.(fragment);
      if (thumbnail != null) return thumbnail;
    }
    return null;
  }
}

/** Tasks past the draft stage, most recently changed first. */
export class ListTasks {
  constructor(private readonly deps: Pick<DraftQueryDeps, 'tasks'>) {}

  async execute(): Promise<Result<{ tasks: readonly TaskView[] }, AppError>> {
    const tasks = await this.deps.tasks.list();
    if (!tasks.ok) return tasks;
    return ok({
      tasks: [...tasks.value]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .flatMap((task) => taskViewOf(task) ?? []),
    });
  }
}
