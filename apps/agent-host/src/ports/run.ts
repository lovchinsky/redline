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
}

/** The gateway, asked about the run's own grant. */
export interface Gateway {
  /** Why the gateway last refused the run, or null when it cannot be reached. */
  grantStatus(): Promise<GrantStatus | null>;
}
