import type { RepositoryRef } from '../../ports/access';
import type { GitRemote, GitRemotes, Publishing } from '../../ports/publishing';

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
