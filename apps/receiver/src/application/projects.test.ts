import { describe, expect, it } from 'vitest';
import type { Publishing } from '../ports/publishing';
import type { HostedRepository, RepositoryRegistry } from '../ports/source';
import { DiscoverRepositories } from './projects';
import { silentLogger } from './testing/fakes';

class MemoryRegistry implements RepositoryRegistry {
  repositories: readonly HostedRepository[] = [];
  replace(repositories: readonly HostedRepository[]) {
    this.repositories = repositories;
    return Promise.resolve();
  }
  list() {
    return Promise.resolve(this.repositories);
  }
}

describe('DiscoverRepositories', () => {
  it('keeps what the git host lists, and what it found before when the host cannot be asked', async () => {
    const registry = new MemoryRegistry();
    let answer: Publishing<readonly HostedRepository[]> = {
      ok: true,
      value: [{ name: 'acme/web', baseBranch: 'main' }],
    };
    const discover = new DiscoverRepositories({
      directory: { list: () => Promise.resolve(answer) },
      registry,
      logger: silentLogger,
    });
    await discover.handle();
    expect(await registry.list()).toEqual([{ name: 'acme/web', baseBranch: 'main' }]);

    answer = { ok: false, error: { transient: true, detail: 'GitHub is unreachable' } };
    await discover.handle();
    expect(await registry.list()).toEqual([{ name: 'acme/web', baseBranch: 'main' }]);
  });
});
