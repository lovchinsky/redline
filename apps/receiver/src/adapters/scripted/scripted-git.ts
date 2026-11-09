import { createHash } from 'node:crypto';
import type { ChangeDescription } from '../../domain/change-policy';
import type { ChangeRequestRef } from '../../domain/work';
import type { RepositoryRef } from '../../ports/access';
import type { ChangeRequestDraft, Forge, Publishing } from '../../ports/publishing';
import {
  NO_SETTINGS,
  type DeterministicCommit,
  type RepositorySettings,
  type SourceRepository,
} from '../../ports/source';

/** The one commit every simulated repository's base branch is at. */
const SCRIPTED_BASE = '0'.repeat(40);

const done = <T>(value: T): Promise<Publishing<T>> => Promise.resolve({ ok: true, value });

/**
 * A git host simulated in memory, for the scripted agent: every repository has the same base and
 * no settings, every change touches one file, commits are hashes of their input, and change requests are
 * numbered per repository at `resultBaseUrl`.
 */
export class ScriptedGit implements SourceRepository, Forge {
  private readonly open_ = new Map<string, ChangeRequestRef>();
  private numbers = 0;

  constructor(private readonly resultBaseUrl: string) {}

  prepare(_repository: RepositoryRef, sha: string | null) {
    return done(sha ?? SCRIPTED_BASE);
  }

  settings(): Promise<Publishing<RepositorySettings>> {
    return done(NO_SETTINGS);
  }

  describe(): Promise<Publishing<ChangeDescription>> {
    return done({
      entries: [
        {
          path: 'src/scripted.tsx',
          previousPath: null,
          status: 'modified',
          mode: 'file',
          binary: false,
          bytes: 120,
          addedLines: 1,
          removedLines: 1,
        },
      ],
      scriptChanges: [],
      secrets: [],
    });
  }

  commit(_repository: RepositoryRef, commit: DeterministicCommit) {
    const sha = createHash('sha1')
      .update(JSON.stringify([commit.baseSha, commit.change.blob, commit.message, commit.at]))
      .digest('hex');
    return done({ sha });
  }

  push() {
    return done(undefined);
  }

  findOpen(repository: RepositoryRef, _publishing: unknown, branch: string) {
    return done(this.open_.get(`${repository.name}#${branch}`) ?? null);
  }

  open(repository: RepositoryRef, _publishing: unknown, draft: ChangeRequestDraft) {
    this.numbers += 1;
    const ref = { id: String(this.numbers), url: `${this.resultBaseUrl}${String(this.numbers)}` };
    this.open_.set(`${repository.name}#${draft.branch}`, ref);
    return done(ref);
  }

  close(repository: RepositoryRef, change: ChangeRequestRef) {
    for (const [key, ref] of this.open_) {
      if (key.startsWith(`${repository.name}#`) && ref.id === change.id) this.open_.delete(key);
    }
    return done(undefined);
  }
}
