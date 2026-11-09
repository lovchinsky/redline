import type { CredentialKind } from '../domain/grant';
import type { Exchange } from '../domain/exchange';
import type { ProjectId, RunId, TaskId } from '../domain/ids';
import type { RunOutcome } from '../domain/run';
import type { Snapshot } from '../domain/work';
import type { BundleContents } from './bundles';
import type { ExecutionProfile, RepositoryRef } from './access';
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
  readonly repository: RepositoryRef;
  readonly baseSha: string;
  readonly brief: AgentBrief;
  /** The paused session the run goes on with (`resumable` said it can), or null to start anew. */
  readonly resumeFrom: Snapshot | null;
  /** The grants of the run's two sandboxes: the setup's (registries) and the agent's (the model). */
  readonly grants: { readonly setup: GrantToken; readonly agent: GrantToken };
  /** The kind of credential behind the agent's grant, which decides how the agent presents it. */
  readonly credential: CredentialKind;
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
  /** Runs that hold something where they run: sandboxes, volumes, memory. */
  live(): Promise<readonly RunId[]>;
  /**
   * Whether a run with `execution` can go on with the session in `snapshot`: its files are
   * kept, and the image and model are the ones that wrote it. A session never resumes on
   * another image or model; the run starts over instead, told the exchanges so far.
   */
  resumable(snapshot: Snapshot, execution: ExecutionProfile): Promise<boolean>;
}
