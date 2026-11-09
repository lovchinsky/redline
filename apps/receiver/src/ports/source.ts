import type { ChangeDescription } from '../domain/change-policy';
import type { Instant } from '../domain/ids';
import type { ChangeRef } from '../domain/work';
import type { PublishingProfile, RepositoryRef } from './access';
import type { Publishing } from './publishing';

/**
 * How a project's team tells the receiver to work on its code, in the repository itself at the
 * task's base: the setup that installs what the code needs, and the checks the agent runs.
 */
export interface RepositorySettings {
  readonly setup: { readonly run: string; readonly timeoutMs: number | null } | null;
  readonly checks: readonly string[];
}

/** The settings of a repository that has none. */
export const NO_SETTINGS: RepositorySettings = { setup: null, checks: [] };

/** The one commit a task publishes. The same input always makes the same commit. */
export interface DeterministicCommit {
  readonly baseSha: string;
  readonly change: ChangeRef;
  readonly message: string;
  /** Author and committer time: the task's, so a retry commits the same SHA. */
  readonly at: Instant;
}

/**
 * A project's code, by commit. The receiver keeps its own copy of what it works on (a cache it
 * fills again from the git host whenever something is missing), so any step of a task can be
 * taken anywhere, however long after the one before. Credentials come from the git host.
 */
export interface SourceRepository {
  /**
   * Makes `sha` (or, when null, the head of the base branch) ready for the steps below, and
   * returns it. Permanent when the host has no such repository, branch or commit.
   */
  prepare(repository: RepositoryRef, sha: string | null): Promise<Publishing<string>>;
  /** The team's settings at `sha`; permanent when they are not valid. */
  settings(repository: RepositoryRef, sha: string): Promise<Publishing<RepositorySettings>>;
  /** Describes the change against its base: what every file becomes, and the secrets it adds. */
  describe(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<ChangeDescription>>;
  commit(
    repository: RepositoryRef,
    commit: DeterministicCommit,
  ): Promise<Publishing<{ readonly sha: string }>>;
  /** Puts `sha` on `branch` of the publishing target, if the branch is absent or already there. */
  push(
    repository: RepositoryRef,
    publishing: PublishingProfile,
    sha: string,
    branch: string,
  ): Promise<Publishing<void>>;
}

/** The project's code at a commit, as a sandbox starts from it. */
export interface SourceTrees {
  /**
   * A working copy of `sha` as a tar archive: the tree and a shallow history, with no remote.
   * Cancelling the stream frees what making it holds.
   */
  workingCopy(repository: RepositoryRef, sha: string): Promise<ReadableStream<Uint8Array>>;
}

/**
 * A repository as git reaches it: its URL, and the `Authorization` header git sends with each
 * request (null when the host needs none). The header is made for one call and lives only in
 * that call's environment: never in a URL, a mirror's configuration or a command line.
 */
export interface GitRemote {
  readonly url: string;
  readonly authorization: string | null;
}

/**
 * Where the receiver's git calls go, by repository and purpose: null when no configured host
 * has the repository, or why the host could not be asked (e.g. its App is not installed).
 */
export interface GitRemotes {
  /** Where a repository's code is fetched from. */
  source(repository: RepositoryRef): Promise<Publishing<GitRemote | null>>;
  /** Where a task's branch is pushed, by the project's publishing target. */
  target(
    repository: RepositoryRef,
    publishing: PublishingProfile,
  ): Promise<Publishing<GitRemote | null>>;
}
