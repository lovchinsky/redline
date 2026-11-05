import type { AssemblyEngine } from '@redline/assembly';
import {
  appError,
  err,
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
import type { TaskWriter } from '../tasks/task-writer';
import type { StoredCaptures } from './stored-captures';

export interface BundleAssemblerDeps {
  readonly tasks: TaskRepository;
  readonly captures: StoredCaptures;
  readonly bundles: BundleRepository;
  readonly engine: AssemblyEngine;
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
 * The frozen bundle of a task's current content: for a draft, the stored one while the draft is
 * unchanged, otherwise a fresh assembly that replaces it; for a task already sent, the one sent. Preview and delivery both go through here, so
 * what the user saw is what gets sent. Callers run it inside the task write queue, so an edit
 * cannot slip between reading the task and storing its bundle.
 */
export class BundleAssembler {
  constructor(private readonly deps: BundleAssemblerDeps) {}

  async frozen(taskId: TaskId): Promise<Result<StoredBundle, AppError>> {
    const { tasks, captures, bundles, engine, clock, clientVersion, logger } = this.deps;
    const task = await tasks.get(taskId);
    if (!task.ok) return task;

    const cached = await bundles.get(taskId);
    if (!cached.ok) return cached;
    const { state } = task.value;
    if (state.kind !== 'draft') {
      // Sent (or on its way): the bundle is what the user approved, even if this version of
      // the extension would assemble it differently. It is never assembled again.
      return cached.value?.bundle.digest === state.delivery.digest
        ? ok(cached.value)
        : err(appError('not-found', 'The frozen bundle of this task is gone', { taskId }));
    }
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

/** Assembles a task for the preview. */
export class AssembleBundle {
  constructor(
    private readonly assembler: BundleAssembler,
    private readonly writer: TaskWriter,
  ) {}

  execute(taskId: TaskId): Promise<Result<BundlePreview, AppError>> {
    return this.writer.run(async () => {
      const stored = await this.assembler.frozen(taskId);
      return stored.ok ? ok(previewOf(stored.value)) : stored;
    });
  }
}
