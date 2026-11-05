import type {
  CaptureContext,
  CaptureEngine,
  CollectionPlanner,
  StepSubject,
} from '@redline/capture';
import type { AppError, Logger, Result } from '@redline/core';
import type { CommittedStep, StepCommitter } from '../../ports/capture';

export interface RecordStepDeps {
  readonly planner: CollectionPlanner;
  readonly engine: CaptureEngine;
  /** Built at commit time, so page facts (scroll, title) are current. */
  readonly context: () => CaptureContext;
  readonly committer: StepCommitter;
  readonly logger: Logger;
}

/** Collects context for a finished step in the page and hands it to the service worker. */
export class RecordStep {
  constructor(private readonly deps: RecordStepDeps) {}

  async execute(step: StepSubject): Promise<Result<CommittedStep, AppError>> {
    const { planner, engine, committer, logger } = this.deps;
    const context = this.deps.context();
    const capture = await engine.run(planner.plan(step.intent), step, context);
    for (const diagnostic of capture.diagnostics) {
      logger.debug('Collector diagnostic', { ...diagnostic });
    }

    const { page } = context;
    return committer.commit(
      {
        url: page.url,
        title: page.title,
        intent: step.intent,
        comment: step.comment,
        viewport: {
          width: page.viewport.width,
          height: page.viewport.height,
          devicePixelRatio: page.devicePixelRatio,
          scrollX: page.scroll.x,
          scrollY: page.scroll.y,
        },
        shapeIds: step.shapes.map((shape) => shape.id),
      },
      capture,
    );
  }
}
