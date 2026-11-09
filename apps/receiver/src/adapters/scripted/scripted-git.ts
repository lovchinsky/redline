import { createHash } from 'node:crypto';
import type { ChangeDescription, SecretFinding } from '../../domain/change-policy';
import type { ChangeRequestRef } from '../../domain/work';
import type { RepositoryRef } from '../../ports/access';
import type {
  ChangeRequestDraft,
  DeterministicCommit,
  Forge,
  Publishing,
  SecretScanner,
  SourceRepository,
} from '../../ports/publishing';

const done = <T>(value: T): Promise<Publishing<T>> => Promise.resolve({ ok: true, value });

/**
 * A git host simulated in memory, for the scripted agent: every repository has the same base,
 * every change touches one file, commits are hashes of their input, and change requests are
 * numbered per repository at `resultBaseUrl`.
 */
export class ScriptedGit implements SourceRepository, SecretScanner, Forge {
  private readonly open_ = new Map<string, ChangeRequestRef>();
  private numbers = 0;

  constructor(private readonly resultBaseUrl: string) {}

  prepare() {
    return done({ baseSha: '0'.repeat(40) });
  }

  describe(): Promise<Publishing<Omit<ChangeDescription, 'secrets'>>> {
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
    });
  }

  scan(): Promise<Publishing<readonly SecretFinding[]>> {
    return done([]);
  }

  commit(_repository: RepositoryRef, commit: DeterministicCommit) {
    const sha = createHash('sha1')
      .update(
        JSON.stringify([
          commit.taskId,
          commit.baseSha,
          commit.change.blob,
          commit.message,
          commit.at,
        ]),
      )
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
