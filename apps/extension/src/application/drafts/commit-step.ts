import {
  CaptureId,
  StepId,
  TaskId,
  addStep,
  createDraft,
  err,
  ok,
  routePatternOf,
  type AppError,
  type Clock,
  type FragmentCatalog,
  type IdGenerator,
  type Logger,
  type Result,
  type Draft,
  type Step,
} from '@redline/core';
import type { StepRecord } from '@redline/rpc';
import type { CaptureRepository, CommittedStep } from '../../ports/capture';
import type { ActiveDraftStore, DraftRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';

export interface CommitStepDeps {
  readonly catalog: FragmentCatalog;
  readonly captures: CaptureRepository;
  readonly drafts: DraftRepository;
  readonly active: ActiveDraftStore;
  readonly writer: WorkspaceWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Stores a captured step and appends it to the active draft, starting a new draft when there
 * is none. Every fragment is re-validated against the schema of its kind first: the content
 * script runs inside a web page, so its output is checked before it is trusted.
 */
export class CommitStep {
  constructor(private readonly deps: CommitStepDeps) {}

  async execute(record: StepRecord, rawCapture: unknown): Promise<Result<CommittedStep, AppError>> {
    const { catalog, captures, writer, ids, clock, logger } = this.deps;
    const capture = catalog.parseCapture(rawCapture);
    if (!capture.ok) return capture;
    for (const diagnostic of capture.value.diagnostics) {
      logger.warn('Collector diagnostic', { ...diagnostic });
    }

    const now = clock.now();
    const captureId = CaptureId.parse(ids.next());
    // Saved before the task: a capture without a step is garbage, a step without context is not.
    const saved = await captures.put({ id: captureId, createdAt: now, capture: capture.value });
    if (!saved.ok) return saved;

    const step: Step = {
      id: StepId.parse(ids.next()),
      page: {
        url: record.url,
        routePattern: routePatternOf(new URL(record.url)),
        title: record.title,
      },
      viewport: record.viewport,
      comment: record.comment,
      shapeIds: record.shapeIds,
      captureId,
      capturedAt: now,
    };

    return writer.run(async (tx) => {
      const draft = await this.activeDraft(now);
      if (!draft.ok) return draft;
      const added = addStep(draft.value.draft, step, now);
      if (!added.ok) return added;
      tx.saveDraft(draft.value.isNew ? null : draft.value.draft, added.value);
      if (draft.value.isNew) tx.setActive(added.value.id);
      return ok({ taskId: added.value.id, stepId: step.id, stepCount: added.value.steps.length });
    });
  }

  private async activeDraft(
    now: number,
  ): Promise<Result<{ readonly draft: Draft; readonly isNew: boolean }, AppError>> {
    const activeId = await this.deps.active.get();
    if (!activeId.ok) return activeId;
    if (activeId.value !== null) {
      const draft = await this.deps.drafts.get(activeId.value);
      if (draft.ok) return ok({ draft: draft.value, isNew: false });
      // The active draft was deleted or sent meanwhile: start a new one. Anything else fails.
      if (draft.error.code !== 'not-found') return err(draft.error);
    }
    return ok({ draft: createDraft(TaskId.parse(this.deps.ids.next()), now), isNew: true });
  }
}
