import {
  FragmentSet,
  err,
  ok,
  runProcessors,
  toAppError,
  type AnyFragment,
  type Clock,
  type Diagnostic,
  type FragmentCatalog,
  type FragmentProcessor,
  type FragmentTarget,
  type Result,
  type StepCapture,
} from '@redline/core';
import type { CaptureContext, CollectorOutcome, ErasedCollector } from './collector';
import type { CollectionPlan } from './planner';
import type { ShapeSubject, StepSubject } from './subject';

export interface ExecutionPolicy {
  readonly defaultTimeoutMs: number;
  /** Per-collector budgets, e.g. screenshots go through the service worker and take longer. */
  readonly timeouts?: Readonly<Record<string, number>>;
}

type Task =
  | {
      readonly level: 'step';
      readonly collector: Extract<ErasedCollector, { level: 'step' }>;
      readonly options: unknown;
    }
  | {
      readonly level: 'shape';
      readonly collector: Extract<ErasedCollector, { level: 'shape' }>;
      readonly options: unknown;
      readonly shape: ShapeSubject;
    };

/** How one collector invocation went: what Diagnostics shows, per step and per shape. */
export interface CollectorRun {
  readonly collector: string;
  readonly target: FragmentTarget;
  readonly outcome: 'collected' | Diagnostic['outcome'];
  readonly durationMs: number;
  readonly fragments: number;
}

export interface CaptureReport {
  /** Wall time of the whole plan, collectors running in parallel, processors included. */
  readonly durationMs: number;
  readonly collectors: readonly CollectorRun[];
}

/** The step's context, and how collecting it went. */
export interface CaptureRun {
  readonly capture: StepCapture;
  readonly report: CaptureReport;
}

interface TaskResult {
  readonly fragments: readonly AnyFragment[];
  readonly diagnostics: readonly Diagnostic[];
  readonly run: CollectorRun;
}

const TIMED_OUT = Symbol('timed-out');

/**
 * Runs a collection plan for one step. Collectors run in parallel and in isolation: a
 * failing, slow or misbehaving collector becomes a diagnostic and never breaks the step.
 * Every produced fragment is validated against its kind's schema before it is accepted.
 */
export class CaptureEngine {
  constructor(
    private readonly catalog: FragmentCatalog,
    private readonly processors: readonly FragmentProcessor<CaptureContext>[],
    private readonly policy: ExecutionPolicy,
    private readonly clock: Clock,
  ) {}

  async run(plan: CollectionPlan, step: StepSubject, context: CaptureContext): Promise<CaptureRun> {
    const startedAt = this.clock.now();
    const tasks = plan.invocations.flatMap(({ collector, options }): Task[] =>
      collector.level === 'step'
        ? [{ level: 'step', collector, options }]
        : step.shapes.map((shape) => ({ level: 'shape', collector, options, shape })),
    );
    const results = await Promise.all(tasks.map((task) => this.execute(task, step, context)));
    const collected = FragmentSet.of(
      results.flatMap((result) => result.fragments),
      results.flatMap((result) => result.diagnostics),
    );
    const capture = (await runProcessors(this.processors, collected, context)).toCapture();
    return {
      capture,
      report: {
        durationMs: this.clock.now() - startedAt,
        collectors: results.map((result) => result.run),
      },
    };
  }

  private async execute(
    task: Task,
    step: StepSubject,
    context: CaptureContext,
  ): Promise<TaskResult> {
    const { collector, options } = task;
    const target: FragmentTarget =
      task.level === 'step' ? { level: 'step' } : { level: 'shape', shapeId: task.shape.id };
    const startedAt = this.clock.now();
    const runOf = (outcome: CollectorRun['outcome'], fragments: number): CollectorRun => ({
      collector: collector.id,
      target,
      outcome,
      durationMs: this.clock.now() - startedAt,
      fragments,
    });
    const diagnose = (outcome: Diagnostic['outcome'], message: string): TaskResult => {
      const run = runOf(outcome, 0);
      return {
        fragments: [],
        diagnostics: [
          { source: collector.id, target, outcome, message, durationMs: run.durationMs },
        ],
        run,
      };
    };

    const controller = new AbortController();
    const timeoutMs = this.policy.timeouts?.[collector.id] ?? this.policy.defaultTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(TIMED_OUT);
      }, timeoutMs);
    });

    try {
      const base = { context, step, options, signal: controller.signal };
      const running: Promise<CollectorOutcome<unknown>> =
        task.level === 'step'
          ? task.collector.collect(base)
          : task.collector.collect({ ...base, shape: task.shape });
      const outcome = await Promise.race([running, timedOut]);

      if (outcome === TIMED_OUT) return diagnose('timed-out', `Exceeded ${String(timeoutMs)} ms`);
      if (outcome.status === 'not-applicable') return diagnose('not-applicable', outcome.reason);
      const accepted = this.accept(collector.produces, collector.priority, target, outcome.items);
      return accepted.ok
        ? {
            fragments: accepted.value,
            diagnostics: [],
            run: runOf('collected', accepted.value.length),
          }
        : diagnose('invalid-output', accepted.error);
    } catch (cause) {
      return diagnose('failed', toAppError(cause).message);
    } finally {
      clearTimeout(timer);
    }
  }

  private accept(
    kind: string,
    defaultPriority: AnyFragment['priority'],
    target: FragmentTarget,
    items: Extract<CollectorOutcome<unknown>, { status: 'collected' }>['items'],
  ): Result<AnyFragment[], string> {
    const descriptor = this.catalog.get(kind);
    if (descriptor === undefined) return err(`Unknown fragment kind "${kind}"`);
    const fragments: AnyFragment[] = [];
    for (const item of items) {
      const parsed = this.catalog.parseFragment({
        kind,
        version: descriptor.version,
        target,
        priority: item.priority ?? defaultPriority,
        data: item.data,
        assets: item.assets ?? [],
      });
      if (!parsed.ok) return err(parsed.error.message);
      fragments.push(parsed.value);
    }
    return ok(fragments);
  }
}
