import type { SecretFinding } from '../domain/change-policy';
import type { Fault, Result } from '../domain/result';
import type { ChangeRef, ChangeRequestRef } from '../domain/work';
import type { PublishingProfile, RepositoryRef } from './access';

/** A step on the git side: its value, or why it did not happen (a transient fault is retried). */
export type Publishing<T> = Result<T, Fault>;

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
