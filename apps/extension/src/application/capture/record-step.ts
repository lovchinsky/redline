import type { CaptureContext, CaptureEngine, CollectionPlan, StepSubject } from '@redline/capture';
import { redactText, redactUrl, type AppError, type Logger, type Result } from '@redline/core';
import type { CommittedStep, StepCommitter } from '../../ports/capture';

export interface RecordStepDeps {
  /** The same plan for every step: what to change is in the comment, not in the context. */
  readonly plan: CollectionPlan;
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
    const { plan, engine, committer, logger } = this.deps;
    const context = this.deps.context();
    const capture = await engine.run(plan, step, context);
    for (const diagnostic of capture.diagnostics) {
      logger.debug('Collector diagnostic', { ...diagnostic });
    }

    const { page } = context;
    return committer.commit(
      {
        // The step's own facts leave the page too; fragments are redacted by the engine.
        url: redactUrl(page.url),
        title: redactText(page.title),
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
