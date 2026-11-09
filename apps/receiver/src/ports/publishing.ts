import type { Fault, Result } from '../domain/result';
import type { ChangeRequestRef } from '../domain/work';
import type { PublishingProfile, RepositoryRef } from './access';

/** A step on the git side: its value, or why it did not happen (a transient fault is retried). */
export type Publishing<T> = Result<T, Fault>;

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
