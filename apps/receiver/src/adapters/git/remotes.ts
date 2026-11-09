import type { PublishingProfile, RepositoryRef } from '../../ports/access';
import type { Publishing } from '../../ports/publishing';

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

/**
 * Repositories by path under `root` (`repository.host: local`). They have no forks: a branch
 * goes to the repository itself, whatever the target.
 */
export class LocalRemotes implements GitRemotes {
  constructor(private readonly root: string) {}

  source(repository: RepositoryRef): Promise<Publishing<GitRemote | null>> {
    return Promise.resolve({
      ok: true,
      value:
        repository.host === 'local'
          ? { url: `file://${this.root}/${repository.name}`, authorization: null }
          : null,
    });
  }

  target(repository: RepositoryRef): Promise<Publishing<GitRemote | null>> {
    return this.source(repository);
  }
}
