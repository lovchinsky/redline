import type { Brief, GrantStatus, Outcome, RunEvent } from '@redline/agent-protocol';
import type { WorkspaceChange } from '../domain/outcome';

/** The run's files: its brief in, its journal and outcome out (`RUN_LAYOUT`). */
export interface RunFiles {
  brief(): Promise<Brief>;
  journal(event: RunEvent): Promise<void>;
  /** Written once, last, and whole: the receiver takes its presence as the end of the run. */
  conclude(outcome: Outcome): Promise<void>;
}

/** The repository the agent works in. */
export interface Workspace {
  /** Exports what changed against `baseSha` as one commit (`RUN_OUTPUTS.change`), or null. */
  exportChange(baseSha: string): Promise<WorkspaceChange>;
  /** Exports the work so far, for a later run to go on with (`RUN_OUTPUTS.work`), or null. */
  exportWork(baseSha: string): Promise<WorkspaceChange>;
  /** Takes the tree of the work of a paused run (`RUN_LAYOUT.work`), still on `baseSha`. */
  restoreWork(baseSha: string, head: string): Promise<void>;
}

/** The gateway, asked about the run's own grant. */
export interface Gateway {
  /** Why the gateway last refused the run, or null when it cannot be reached. */
  grantStatus(): Promise<GrantStatus | null>;
}
