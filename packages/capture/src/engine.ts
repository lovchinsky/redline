import {
  FragmentSet,
  runProcessors,
  toAppError,
  type AnyFragment,
  type Clock,
  type Diagnostic,
  type FragmentCatalog,
  type FragmentProcessor,
  type FragmentTarget,
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

interface TaskResult {
  readonly fragments: readonly AnyFragment[];
  readonly diagnostics: readonly Diagnostic[];
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

  async run(
    plan: CollectionPlan,
    step: StepSubject,
    context: CaptureContext,
  ): Promise<StepCapture> {
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
    return (await runProcessors(this.processors, collected, context)).toCapture();
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
    const diagnose = (outcome: Diagnostic['outcome'], message: string): TaskResult => ({
      fragments: [],
      diagnostics: [
        {
          source: collector.id,
          target,
          outcome,
          message,
          durationMs: this.clock.now() - startedAt,
        },
      ],
    });

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
      return this.accept(collector.produces, collector.priority, target, outcome.items, diagnose);
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
    diagnose: (outcome: Diagnostic['outcome'], message: string) => TaskResult,
  ): TaskResult {
    const descriptor = this.catalog.get(kind);
    if (descriptor === undefined)
      return diagnose('invalid-output', `Unknown fragment kind "${kind}"`);
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
      if (!parsed.ok) return diagnose('invalid-output', parsed.error.message);
      fragments.push(parsed.value);
    }
    return { fragments, diagnostics: [] };
  }
}
