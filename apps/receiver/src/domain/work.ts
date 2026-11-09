import type { BlobDigest } from './ids';

/**
 * What a paused session needs to go on: the work so far and the agent's session, stored as one
 * blob, and the exact image and model that wrote it. A session resumes only on the same image
 * and model; when they are gone the task starts over with the conversation replayed.
 */
export interface Snapshot {
  readonly blob: BlobDigest;
  readonly image: string;
  readonly model: string;
}

/** The agent's proposed change: one commit on top of the task's base, stored as a git bundle. */
export interface ChangeRef {
  readonly blob: BlobDigest;
  /** The commit the run named: the bundle is taken only when it carries exactly this commit. */
  readonly head: string;
}

/** The agent's own account of its work. Untrusted text: it is quoted, never interpreted. */
export interface AgentReport {
  readonly summary: string;
  readonly changes: readonly { readonly file: string; readonly why: string }[];
  readonly verification: string;
  readonly assumptions: readonly string[];
}

/** A change request (pull or merge request) on the project's git host. */
export interface ChangeRequestRef {
  /** The git host's own id of it, e.g. the pull request number. */
  readonly id: string;
  /** The page the requester opens to see the result. */
  readonly url: string;
}
