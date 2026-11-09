import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { DiffEntry, ScriptChange } from '../../domain/change-policy';
import type { TaskId } from '../../domain/ids';
import type { ChangeRef } from '../../domain/work';
import type { RepositoryRef } from '../../ports/access';
import type { BlobStore } from '../../ports/bundles';
import type { DeterministicCommit, Publishing, SourceRepository } from '../../ports/publishing';
import { GitError, git, streamOf } from './git';

/** The ref a change bundle carries its commit at (`CHANGE_REF` of the agent protocol). */
const BUNDLE_REF = 'refs/redline/change';
/** How deep a sandbox's working copy is: enough history for blame and log, not all of it. */
const WORKSPACE_DEPTH = 50;

const ok = <T>(value: T): Publishing<T> => ({ ok: true, value });
const fail = (detail: string, transient: boolean): Publishing<never> => ({
  ok: false,
  error: { detail, transient },
});

const MODES: Readonly<Record<string, DiffEntry['mode']>> = {
  '100644': 'file',
  '100755': 'executable',
  '120000': 'symlink',
  '160000': 'submodule',
};

const STATUS: Readonly<Record<string, DiffEntry['status']>> = {
  A: 'added',
  M: 'modified',
  T: 'modified',
  D: 'deleted',
  R: 'renamed',
};

const scriptsOf = (text: string | null): Record<string, string> => {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    const scripts =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)['scripts']
        : null;
    if (typeof scripts !== 'object' || scripts === null) return {};
    return Object.fromEntries(
      Object.entries(scripts).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
};

export interface GitMirrorsOptions {
  /** Where the mirrors are kept. */
  readonly root: string;
  /** The URL of a repository, or null when its git host is not one these mirrors reach. */
  readonly urlOf: (repository: RepositoryRef) => string | null;
  /** Who the receiver's commits are by. */
  readonly identity: { readonly name: string; readonly email: string };
  readonly blobs: BlobStore;
}

/**
 * The receiver's own mirrors of its projects' repositories: the base of every task is pinned
 * in them, sandboxes get their working copies from them, and the agent's change is imported,
 * described and committed in them. Git runs with every repository-controlled hook off.
 */
export class GitMirrors implements SourceRepository {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: GitMirrorsOptions) {}

  async prepare(
    repository: RepositoryRef,
    taskId: TaskId,
  ): Promise<Publishing<{ readonly baseSha: string }>> {
    const url = this.options.urlOf(repository);
    if (url === null) return fail(`No git host ${repository.host} is configured`, false);
    try {
      return await this.locked(repository, async (mirror) => {
        try {
          await access(mirror);
          await git(mirror, ['fetch', '--prune', '--quiet', url, '+refs/heads/*:refs/heads/*']);
        } catch (error) {
          if (error instanceof GitError) throw error;
          await mkdir(path.dirname(mirror), { recursive: true });
          await git(path.dirname(mirror), ['clone', '--mirror', '--quiet', url, mirror]);
        }
        const baseSha = await git(mirror, [
          'rev-parse',
          '--verify',
          `refs/heads/${repository.baseBranch}^{commit}`,
        ]);
        await git(mirror, ['update-ref', this.baseRef(taskId), baseSha]);
        return ok({ baseSha });
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), true);
    }
  }

  /**
   * A working copy of the task's base as a tar archive: the tree and a shallow history, with no
   * remote. What a sandbox starts from.
   */
  async workingCopy(repository: RepositoryRef, taskId: TaskId): Promise<Readable> {
    const mirror = this.mirrorOf(repository);
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-copy-'));
    const copy = path.join(scratch, 'workspace');
    await git(scratch, ['init', '--quiet', copy]);
    await git(copy, [
      'fetch',
      '--quiet',
      `--depth=${String(WORKSPACE_DEPTH)}`,
      `file://${mirror}`,
      this.baseRef(taskId),
    ]);
    await git(copy, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    const archive = streamOf('tar', ['-C', copy, '-cf', '-', '.'], scratch);
    archive.on('close', () => {
      void rm(scratch, { recursive: true, force: true });
    });
    return archive;
  }

  /** A file of the repository at `sha`, or null when there is none. */
  async fileAt(repository: RepositoryRef, sha: string, file: string): Promise<string | null> {
    try {
      return await git(this.mirrorOf(repository), ['show', `${sha}:${file}`]);
    } catch (error) {
      if (error instanceof GitError) return null;
      throw error;
    }
  }

  async describe(repository: RepositoryRef, baseSha: string, change: ChangeRef) {
    const imported = await this.importChange(repository, baseSha, change);
    if (!imported.ok) return imported;
    const mirror = this.mirrorOf(repository);
    const head = imported.value;
    const raw = await git(mirror, ['diff', '--raw', '-z', '-M', '--no-abbrev', baseSha, head]);
    const numstat = await git(mirror, ['diff', '--numstat', '-z', '-M', baseSha, head]);
    const lines = this.numstatOf(numstat);
    const entries: DiffEntry[] = [];
    const fields = raw.split('\0');
    for (let i = 0; i < fields.length - 1;) {
      const meta = fields[i] ?? '';
      i += 1;
      const [, newMode = '', , newObject = '', statusField = ''] = meta.slice(1).split(' ');
      const status = statusField.charAt(0);
      const first = fields[i] ?? '';
      i += 1;
      const second = status === 'R' || status === 'C' ? (fields[i++] ?? '') : null;
      const file = second ?? first;
      const counted = lines.get(file);
      const deleted = status === 'D';
      entries.push({
        path: file,
        previousPath: second === null ? null : first,
        status: STATUS[status] ?? 'modified',
        mode: deleted ? 'file' : (MODES[newMode] ?? 'file'),
        binary: counted?.binary ?? false,
        bytes:
          deleted || MODES[newMode] === 'submodule'
            ? 0
            : Number(await git(mirror, ['cat-file', '-s', newObject])),
        addedLines: counted?.added ?? 0,
        removedLines: counted?.removed ?? 0,
      });
    }
    const scriptChanges: ScriptChange[] = [];
    for (const entry of entries) {
      if (path.posix.basename(entry.path) !== 'package.json') continue;
      const before = scriptsOf(
        await this.fileAt(repository, baseSha, entry.previousPath ?? entry.path),
      );
      const after = scriptsOf(
        entry.status === 'deleted' ? null : await this.fileAt(repository, head, entry.path),
      );
      const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (name) => before[name] !== after[name],
      );
      if (names.length > 0) scriptChanges.push({ path: entry.path, scripts: names.sort() });
    }
    return ok({ entries, scriptChanges });
  }

  async commit(repository: RepositoryRef, commit: DeterministicCommit) {
    const imported = await this.importChange(repository, commit.baseSha, commit.change);
    if (!imported.ok) return imported;
    const mirror = this.mirrorOf(repository);
    const tree = await git(mirror, ['rev-parse', `${imported.value}^{tree}`]);
    const date = `@${String(Math.floor(commit.at / 1000))} +0000`;
    const { name, email } = this.options.identity;
    const sha = await git(
      mirror,
      ['commit-tree', tree, '-p', commit.baseSha, '-m', commit.message],
      {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_COMMITTER_DATE: date,
      },
    );
    await git(mirror, ['update-ref', `refs/redline/commit/${commit.taskId}`, sha]);
    return ok({ sha });
  }

  async push(repository: RepositoryRef, _publishing: unknown, sha: string, branch: string) {
    const url = this.options.urlOf(repository);
    if (url === null) return fail(`No git host ${repository.host} is configured`, false);
    const mirror = this.mirrorOf(repository);
    try {
      const listed = await git(mirror, ['ls-remote', url, `refs/heads/${branch}`]);
      const current = listed.split(/\s/)[0] ?? '';
      if (current === sha) return ok(undefined);
      if (current !== '') return fail(`The branch ${branch} moved to ${current}`, false);
      await git(mirror, [
        'push',
        '--quiet',
        `--force-with-lease=refs/heads/${branch}:`,
        url,
        `${sha}:refs/heads/${branch}`,
      ]);
      return ok(undefined);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), true);
    }
  }

  /**
   * Fetches a change bundle into the mirror. A change is one commit whose parent is the base:
   * anything else is not a change the receiver takes.
   */
  private async importChange(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<string>> {
    const bytes = await this.options.blobs.read(change.blob);
    if (bytes === null) return fail('The change is no longer stored', false);
    const mirror = this.mirrorOf(repository);
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-change-'));
    try {
      const file = path.join(scratch, 'change.bundle');
      await writeFile(file, bytes);
      const ref = `refs/redline/changes/${change.blob}`;
      try {
        await git(mirror, ['bundle', 'verify', '--quiet', file]);
        await git(mirror, ['fetch', '--quiet', '--no-tags', file, `+${BUNDLE_REF}:${ref}`]);
      } catch (error) {
        return fail(`The change is not a git bundle of this repository: ${String(error)}`, false);
      }
      const head = await git(mirror, ['rev-parse', ref]);
      const parents = (await git(mirror, ['rev-list', '--parents', '-n', '1', head]))
        .split(' ')
        .slice(1);
      if (parents.length !== 1 || parents[0] !== baseSha) {
        return fail('The change is not one commit on the task’s base', false);
      }
      return ok(head);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  private numstatOf(numstat: string) {
    const counts = new Map<string, { added: number; removed: number; binary: boolean }>();
    const fields = numstat.split('\0');
    for (let i = 0; i < fields.length; i += 1) {
      const field = fields[i] ?? '';
      if (field === '') continue;
      const [added = '', removed = '', file = ''] = field.split('\t');
      // A rename lists its paths in the two fields that follow.
      const target = file === '' ? (fields[(i += 2)] ?? '') : file;
      const binary = added === '-';
      counts.set(target, {
        added: binary ? 0 : Number(added),
        removed: binary ? 0 : Number(removed),
        binary,
      });
    }
    return counts;
  }

  private baseRef(taskId: TaskId) {
    return `refs/redline/base/${taskId}`;
  }

  private mirrorOf(repository: RepositoryRef): string {
    const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.options.root, safe(repository.host), `${safe(repository.name)}.git`);
  }

  /** One git operation per mirror at a time. */
  private async locked<T>(
    repository: RepositoryRef,
    work: (mirror: string) => Promise<T>,
  ): Promise<T> {
    const mirror = this.mirrorOf(repository);
    const previous = this.locks.get(mirror) ?? Promise.resolve();
    const next = previous.then(
      () => work(mirror),
      () => work(mirror),
    );
    this.locks.set(
      mirror,
      next.catch(() => undefined),
    );
    return next;
  }
}
