import type {
  CaptureContext,
  CaptureEngine,
  CaptureReport,
  CollectionPlan,
  StepSubject,
} from '@redline/capture';
import { redactText, redactUrl, type AppError, type Logger, type Result } from '@redline/core';
import type { CaptureReportInput } from '@redline/rpc';
import type { CommittedStep, StepCommitter } from '../../ports/capture';
import type { CaptureJournal } from '../../ports/diagnostics';

export interface RecordStepDeps {
  /** The same plan for every step: what to change is in the comment, not in the context. */
  readonly plan: CollectionPlan;
  readonly engine: CaptureEngine;
  /** Built at commit time, so page facts (scroll, title) are current. */
  readonly context: () => CaptureContext;
  readonly committer: StepCommitter;
  readonly journal: CaptureJournal;
  readonly logger: Logger;
}

/** Collects context for a finished step in the page and hands it to the service worker. */
export class RecordStep {
  constructor(private readonly deps: RecordStepDeps) {}

  async execute(step: StepSubject): Promise<Result<CommittedStep, AppError>> {
    const { plan, engine, committer, journal, logger } = this.deps;
    const context = this.deps.context();
    const { capture, report } = await engine.run(plan, step, context);
    for (const diagnostic of capture.diagnostics) {
      logger.debug('Collector diagnostic', { ...diagnostic });
    }

    const { page } = context;
    const [committed] = await Promise.all([
      committer.commit(
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
      ),
      journal.record(reportOf(step, page.url, report)),
    ]);
    return committed;
  }
}

/** The journal keeps where and how collection went, never what was collected. */
const reportOf = (step: StepSubject, url: string, report: CaptureReport): CaptureReportInput => {
  const area = new Map(step.shapes.map((shape, index) => [shape.id, index + 1]));
  const { origin, pathname } = new URL(redactUrl(url));
  return {
    page: `${origin}${pathname}`,
    areas: step.shapes.length,
    durationMs: report.durationMs,
    collectors: report.collectors.map((run) => ({
      collector: run.collector,
      area: run.target.level === 'step' ? null : (area.get(run.target.shapeId) ?? null),
      outcome: run.outcome,
      durationMs: run.durationMs,
      fragments: run.fragments,
    })),
  };
};
