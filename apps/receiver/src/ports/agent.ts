import type { Exchange } from '../domain/exchange';
import type { ProjectId, RunId, TaskId } from '../domain/ids';
import type { RunOutcome } from '../domain/run';
import type { Snapshot } from '../domain/work';
import type { BundleContents } from './bundles';
import type { ExecutionProfile } from './access';
import type { GrantToken } from './tasks';

/** Everything the agent is told about a task. Composed by the application, sent by the runner. */
export interface AgentBrief {
  readonly title: string;
  /** The bundle: its steps are the task, its files are reference material from the page. */
  readonly bundle: BundleContents;
  readonly exchanges: readonly Exchange[];
  readonly questionsLeft: number;
  /** Paths the agent must not change, so it does not try to. */
  readonly protectedPaths: readonly string[];
  readonly limits: { readonly maxFiles: number; readonly maxChangedLines: number };
}

export interface RunSpec {
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly project: ProjectId;
  readonly baseSha: string;
  readonly brief: AgentBrief;
  readonly resumeFrom: Snapshot | null;
  readonly grant: GrantToken;
  readonly execution: ExecutionProfile;
}

export type RunnerError = { readonly transient: boolean; readonly detail: string };

/**
 * Runs the agent somewhere it holds no secrets. A run outlives the process that started it:
 * `observe` attaches to a run started earlier, possibly by a process that is gone.
 */
export interface AgentRunner {
  /** Starts a run; does nothing when the run already exists. */
  start(
    spec: RunSpec,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: RunnerError }>;
  /**
   * Waits for the run's outcome. A run that no longer exists and left no outcome is `lost`.
   * Aborting `signal` stops waiting; the run goes on.
   */
  observe(
    runId: RunId,
    signal: AbortSignal,
  ): Promise<RunOutcome | { readonly kind: 'lost'; readonly detail: string }>;
  abort(runId: RunId): Promise<void>;
  /** Frees what the run holds once its outcome has been applied. */
  release(runId: RunId): Promise<void>;
}
