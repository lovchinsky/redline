import { ok, type AppError, type Result, type Step, type TaskId } from '@redline/core';
import type { BundleManifest } from '@redline/contract';
import type { SentStep, SentTask, TaskView } from '@redline/rpc';
import type { BundleRepository } from '../../ports/drafts';
import type { TaskRepository } from '../../ports/workspace';
import { frozenBundleOf } from '../drafts/frozen-bundle';
import { taskViewOf } from './task-view';

/** Sent tasks, most recently changed first, as the side panel shows them. */
export class ListTasks {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(): Promise<Result<{ tasks: readonly TaskView[] }, AppError>> {
    const tasks = await this.tasks.list();
    if (!tasks.ok) return tasks;
    return ok({
      tasks: [...tasks.value].sort((a, b) => b.updatedAt - a.updatedAt).map(taskViewOf),
    });
  }
}

/** The first image of the step's first circled area, as the bundle lists it. */
const imageOf = (manifest: BundleManifest, stepId: string): string | null => {
  const images = new Set(
    manifest.files.filter((file) => file.mediaType.startsWith('image/')).map((file) => file.path),
  );
  const step = manifest.steps.find((candidate) => candidate.id === stepId);
  return step?.shapes[0]?.files.find((path) => images.has(path)) ?? null;
};

const sentStepOf = (step: Step, manifest: BundleManifest | null): SentStep => ({
  id: step.id,
  comment: step.comment,
  page: step.page,
  image: manifest === null ? null : imageOf(manifest, step.id),
});

/** The steps of a sent task, and the bundle that was delivered for them. */
export class GetTask {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly bundles: BundleRepository,
  ) {}

  async execute(taskId: TaskId): Promise<Result<SentTask, AppError>> {
    const task = await this.tasks.get(taskId);
    if (!task.ok) return task;
    const stored = await this.bundles.get(taskId);
    if (!stored.ok) return stored;
    // Only the bundle that was delivered describes the task; anything else is not its content.
    const bundle =
      stored.value?.bundle.digest === task.value.state.delivery.digest ? stored.value.bundle : null;
    return ok({
      id: task.value.id,
      steps: task.value.steps.map((step) => sentStepOf(step, bundle?.manifest ?? null)),
      bundle: bundle === null ? null : frozenBundleOf(task.value.id, bundle),
    });
  }
}
