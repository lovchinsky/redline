import type { AssemblyEngine } from '@redline/assembly';
import {
  ok,
  type AppError,
  type Clock,
  type Logger,
  type Result,
  type StepCapture,
  type TaskId,
} from '@redline/core';
import type { BundlePreview } from '@redline/rpc';
import type { BundleRepository, StoredBundle, TaskRepository } from '../../ports/drafts';
import type { DraftWriter } from './draft-writer';
import type { StoredCaptures } from './stored-captures';

export interface AssembleBundleDeps {
  readonly tasks: TaskRepository;
  readonly captures: StoredCaptures;
  readonly bundles: BundleRepository;
  readonly engine: AssemblyEngine;
  readonly writer: DraftWriter;
  readonly clock: Clock;
  readonly clientVersion: string;
  readonly logger: Logger;
}

const previewOf = ({ taskId, revision, bundle, warnings }: StoredBundle): BundlePreview => ({
  taskId,
  revision,
  digest: bundle.digest,
  createdAt: bundle.manifest.createdAt,
  entry: bundle.manifest.entry,
  files: bundle.manifest.files.map(({ path, mediaType, bytes }) => ({ path, mediaType, bytes })),
  warnings,
});

/**
 * Assembles a task into a frozen bundle and keeps it. While the task is unchanged the stored
 * bundle is reused, so the preview and the delivery are the same bytes, not two assemblies.
 * Runs in the write queue: an edit cannot slip between reading the task and storing its bundle.
 */
export class AssembleBundle {
  constructor(private readonly deps: AssembleBundleDeps) {}

  execute(taskId: TaskId): Promise<Result<BundlePreview, AppError>> {
    return this.deps.writer.run(async () => {
      const stored = await this.assembled(taskId);
      return stored.ok ? ok(previewOf(stored.value)) : stored;
    });
  }

  private async assembled(taskId: TaskId): Promise<Result<StoredBundle, AppError>> {
    const { tasks, captures, bundles, engine, clock, clientVersion, logger } = this.deps;
    const task = await tasks.get(taskId);
    if (!task.ok) return task;

    const cached = await bundles.get(taskId);
    if (!cached.ok) return cached;
    if (
      cached.value?.revision === task.value.revision &&
      cached.value.clientVersion === clientVersion
    ) {
      return ok(cached.value);
    }

    const loaded = new Map<string, StepCapture>();
    for (const step of task.value.steps) {
      const capture = await captures.load(step.captureId);
      if (!capture.ok) return capture;
      loaded.set(step.captureId, capture.value);
    }
    const assembled = await engine.assemble({
      task: task.value,
      captures: loaded,
      createdAt: new Date(clock.now()).toISOString(),
      clientVersion,
    });
    if (!assembled.ok) return assembled;
    for (const warning of assembled.value.warnings) logger.warn('Assembly warning', { warning });

    const fresh: StoredBundle = {
      taskId,
      revision: task.value.revision,
      clientVersion,
      bundle: assembled.value.bundle,
      warnings: assembled.value.warnings,
    };
    const saved = await bundles.put(fresh);
    return saved.ok ? ok(fresh) : saved;
  }
}
