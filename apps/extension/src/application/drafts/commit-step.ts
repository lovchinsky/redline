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
  type Step,
  type Task,
} from '@redline/core';
import type { StepRecord } from '@redline/rpc';
import type { CaptureRepository, CommittedStep } from '../../ports/capture';
import type { ActiveDraftStore, TaskRepository } from '../../ports/drafts';
import type { DraftWriter } from './draft-writer';

export interface CommitStepDeps {
  readonly catalog: FragmentCatalog;
  readonly captures: CaptureRepository;
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly writer: DraftWriter;
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
      intent: record.intent,
      comment: record.comment,
      shapeIds: record.shapeIds,
      captureId,
      capturedAt: now,
    };

    return writer.run(async () => {
      const draft = await this.activeDraft(now);
      if (!draft.ok) return draft;
      const added = addStep(draft.value.task, step, now);
      if (!added.ok) return added;

      const stored = await this.deps.tasks.save(added.value);
      if (!stored.ok) return stored;
      if (draft.value.isNew) {
        const activated = await this.deps.active.set(added.value.id);
        if (!activated.ok) return activated;
      }
      await writer.announce(added.value.id);
      return ok({ taskId: added.value.id, stepId: step.id, stepCount: added.value.steps.length });
    });
  }

  private async activeDraft(
    now: number,
  ): Promise<Result<{ readonly task: Task; readonly isNew: boolean }, AppError>> {
    const activeId = await this.deps.active.get();
    if (!activeId.ok) return activeId;
    if (activeId.value !== null) {
      const task = await this.deps.tasks.get(activeId.value);
      if (task.ok) return ok({ task: task.value, isNew: false });
      // The active draft was deleted meanwhile: start a new one. Anything else is a failure.
      if (task.error.code !== 'not-found') return err(task.error);
    }
    return ok({ task: createDraft(TaskId.parse(this.deps.ids.next()), now), isNew: true });
  }
}
