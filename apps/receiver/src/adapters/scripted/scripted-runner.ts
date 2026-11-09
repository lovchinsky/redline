import { QuestionId, type BlobDigest, type RunId } from '../../domain/ids';
import type { RunOutcome } from '../../domain/run';
import type { AgentRunner, RunSpec } from '../../ports/agent';

export interface ScriptedAgentOptions {
  /** How long a scripted run takes. */
  readonly durationMs: number;
  /** Whether the agent asks one question before it changes anything. */
  readonly asks: boolean;
}

/** The change a scripted agent proposes: no real code, the same for every task. */
export const SCRIPTED_CHANGE =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' as BlobDigest;
export const SCRIPTED_HEAD = '5c41ed0000000000000000000000000000000000';

/**
 * An agent that follows a script instead of a model: it asks one question (if configured) and
 * then proposes a change. It runs the whole receiver without a sandbox or model access, for
 * trying the receiver out and for end-to-end tests of the extension. Runs live in memory:
 * after a restart they are lost, and the receiver runs the task again.
 */
export class ScriptedRunner implements AgentRunner {
  private readonly runs = new Map<
    RunId,
    { readonly spec: RunSpec; readonly endsAt: number; aborted: boolean }
  >();

  constructor(
    private readonly options: ScriptedAgentOptions,
    private readonly now: () => number,
  ) {}

  start(spec: RunSpec) {
    if (!this.runs.has(spec.runId)) {
      this.runs.set(spec.runId, {
        spec,
        endsAt: this.now() + this.options.durationMs,
        aborted: false,
      });
    }
    return Promise.resolve({ ok: true as const });
  }

  async observe(
    runId: RunId,
    signal: AbortSignal,
  ): Promise<RunOutcome | { kind: 'lost'; detail: string }> {
    const run = this.runs.get(runId);
    if (run === undefined)
      return { kind: 'lost', detail: 'the scripted run is not in this process' };
    await this.until(run.endsAt, signal);
    if (run.aborted) return { kind: 'failed', reason: 'infra', detail: 'aborted', snapshot: null };
    return this.outcomeOf(run.spec);
  }

  abort(runId: RunId): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) run.aborted = true;
    return Promise.resolve();
  }

  release(runId: RunId): Promise<void> {
    this.runs.delete(runId);
    return Promise.resolve();
  }

  live(): Promise<readonly RunId[]> {
    return Promise.resolve([...this.runs.keys()]);
  }

  /** A scripted run keeps no session, so it never leaves a snapshot to resume. */
  resumable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  private outcomeOf(spec: RunSpec): RunOutcome {
    const { brief } = spec;
    if (this.options.asks && brief.exchanges.length === 0 && brief.questionsLeft > 0) {
      return {
        kind: 'question',
        question: {
          id: QuestionId(`q-${spec.taskId}-1`),
          text: 'Should the change apply to every breakpoint?',
          options: ['Yes', 'Desktop only'],
        },
        snapshot: null,
      };
    }
    const answer = brief.exchanges.at(-1)?.answer;
    return {
      kind: 'change',
      change: { blob: SCRIPTED_CHANGE, head: SCRIPTED_HEAD },
      report: {
        summary: `Scripted change for: ${brief.title}`,
        changes: brief.bundle.steps.map((step) => ({
          file: 'src/scripted.tsx',
          why: step.comment,
        })),
        verification: 'None: the scripted agent changes nothing real.',
        assumptions: answer?.source === 'requester' ? [`Answer taken: ${answer.text}`] : [],
      },
    };
  }

  private until(at: number, signal: AbortSignal): Promise<void> {
    const wait = Math.max(0, at - this.now());
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
