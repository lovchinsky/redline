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
import type { BundleRepository, StoredBundle } from '../../ports/drafts';
import type { DraftRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';
import { frozenBundleOf } from './frozen-bundle';
import type { StoredCaptures } from './stored-captures';

export interface BundleAssemblerDeps {
  readonly drafts: DraftRepository;
  readonly captures: StoredCaptures;
  readonly bundles: BundleRepository;
  readonly engine: AssemblyEngine;
  readonly clock: Clock;
  readonly clientVersion: string;
  readonly logger: Logger;
}

const previewOf = ({ taskId, revision, bundle, warnings }: StoredBundle): BundlePreview => ({
  ...frozenBundleOf(taskId, bundle),
  revision,
  createdAt: bundle.manifest.createdAt,
  warnings,
});

/**
 * The frozen bundle of a draft's current content: the stored one while the draft is unchanged
 * (and assembled by this version), otherwise a fresh assembly that replaces it. Preview and
 * sending both go through here, so what the user saw is what gets sent; once sent, the task
 * owns the bundle and no draft of that id exists to assemble it again. Callers run it in the
 * workspace's turn, so an edit cannot slip between reading the draft and storing its bundle.
 */
export class BundleAssembler {
  constructor(private readonly deps: BundleAssemblerDeps) {}

  async frozen(taskId: TaskId): Promise<Result<StoredBundle, AppError>> {
    const { drafts, captures, bundles, engine, clock, clientVersion, logger } = this.deps;
    const draft = await drafts.get(taskId);
    if (!draft.ok) return draft;

    const cached = await bundles.get(taskId);
    if (!cached.ok) return cached;
    if (
      cached.value?.revision === draft.value.revision &&
      cached.value.clientVersion === clientVersion
    ) {
      return ok(cached.value);
    }

    const loaded = new Map<string, StepCapture>();
    for (const step of draft.value.steps) {
      const capture = await captures.load(step.captureId);
      if (!capture.ok) return capture;
      loaded.set(step.captureId, capture.value);
    }
    const assembled = await engine.assemble({
      task: draft.value,
      captures: loaded,
      createdAt: new Date(clock.now()).toISOString(),
      clientVersion,
    });
    if (!assembled.ok) return assembled;
    for (const warning of assembled.value.warnings) logger.warn('Assembly warning', { warning });

    const fresh: StoredBundle = {
      taskId,
      revision: draft.value.revision,
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
    private readonly writer: WorkspaceWriter,
  ) {}

  execute(taskId: TaskId): Promise<Result<BundlePreview, AppError>> {
    return this.writer.exclusive(async () => {
      const stored = await this.assembler.frozen(taskId);
      return stored.ok ? ok(previewOf(stored.value)) : stored;
    });
  }
}
