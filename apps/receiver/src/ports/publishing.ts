import type { ChangeDescription, SecretFinding } from '../domain/change-policy';
import type { Instant, TaskId } from '../domain/ids';
import type { ChangeRef, ChangeRequestRef } from '../domain/work';
import type { PublishingProfile, RepositoryRef } from './access';

/** Why publishing did not happen; `transient` failures are retried. */
export interface PublishError {
  readonly transient: boolean;
  readonly detail: string;
}

export type Publishing<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PublishError };

/** The one commit a task publishes. The same input always makes the same commit. */
export interface DeterministicCommit {
  readonly taskId: TaskId;
  readonly baseSha: string;
  readonly change: ChangeRef;
  readonly message: string;
  /** Author and committer time: the task's, so a retry commits the same SHA. */
  readonly at: Instant;
}

/** A repository's code, as the receiver's own mirror of it. Credentials come from the git host. */
export interface SourceRepository {
  /** Fetches the base branch and pins its head for the task; returns the head. */
  prepare(
    repository: RepositoryRef,
    taskId: TaskId,
  ): Promise<Publishing<{ readonly baseSha: string }>>;
  /** Describes the change against its base: what every file becomes. */
  describe(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<Omit<ChangeDescription, 'secrets'>>>;
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

/** Finds secrets in the new content of a change. */
export interface SecretScanner {
  scan(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<readonly SecretFinding[]>>;
}

export interface ChangeRequestDraft {
  readonly branch: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
  readonly labels: readonly string[];
}

/** The git host's change requests (pull or merge requests). */
export interface Forge {
  findOpen(
    repository: RepositoryRef,
    publishing: PublishingProfile,
    branch: string,
  ): Promise<Publishing<ChangeRequestRef | null>>;
  open(
    repository: RepositoryRef,
    publishing: PublishingProfile,
    draft: ChangeRequestDraft,
  ): Promise<Publishing<ChangeRequestRef>>;
  close(repository: RepositoryRef, change: ChangeRequestRef): Promise<Publishing<void>>;
}
