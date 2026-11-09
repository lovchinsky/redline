import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ChangeDescription, DiffEntry, ScriptChange } from '../../domain/change-policy';
import { err, ok } from '../../domain/result';
import type { ChangeRef } from '../../domain/work';
import type { PublishingProfile, RepositoryRef } from '../../ports/access';
import type { BlobStore } from '../../ports/bundles';
import type { Publishing } from '../../ports/publishing';
import type {
  DeterministicCommit,
  GitRemote,
  GitRemotes,
  RepositorySettings,
  SourceRepository,
  SourceTrees,
} from '../../ports/source';
import { git, reaching, streamOf } from './git';
import { REPOSITORY_SETTINGS, parseRepositorySettings } from './repository-settings';
import type { SecretFinder } from './secrets';

/** The ref a change bundle carries its commit at (`CHANGE_REF` of the agent protocol). */
const BUNDLE_REF = 'refs/redline/change';
/** How deep a sandbox's working copy is: enough history for blame and log, not all of it. */
const WORKSPACE_DEPTH = 50;

/** The ref that keeps a commit a task works on in the mirror, whatever its branches do. */
const keepRef = (sha: string) => `refs/redline/keep/${sha}`;

/** The pack of a git bundle (v2 or v3): what follows its header, which ends at a blank line. */
const packOf = (bundle: Uint8Array): Uint8Array => {
  const bytes = Buffer.from(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  const signature = bytes.subarray(0, 16).toString('latin1');
  const end = bytes.indexOf('\n\n');
  if (!/^# v[23] git bundle$/.test(signature.split('\n')[0] ?? '') || end === -1) {
    throw new Error('Not a git bundle');
  }
  return bytes.subarray(end + 2);
};

const fail = (detail: string, transient: boolean): Publishing<never> => err({ detail, transient });

/**
 * The step's result, or its failure as transient: every cause a repository, a remote or a change
 * can give is checked for, and named permanent, before a command depends on it; a command that
 * fails anyway fails for the machine's sake (its disk, its network), and may not next time.
 */
const attempt = async <T>(step: () => Promise<Publishing<T>>): Promise<Publishing<T>> => {
  try {
    return await step();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), true);
  }
};

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
  /** Where repositories are fetched from and branches pushed to. */
  readonly remotes: GitRemotes;
  /** Who the receiver's commits are by. */
  readonly identity: { readonly name: string; readonly email: string };
  readonly blobs: BlobStore;
  /** What finds secrets in a change before it is described as fit to publish. */
  readonly secrets: SecretFinder;
}

/**
 * The receiver's own mirrors of its projects' repositories: sandboxes get their working copies
 * from them, and the agent's change is imported, described and committed in them. A mirror is
 * a cache: a commit a step needs and the mirror lacks is fetched again, and the commits tasks
 * work on are kept from garbage collection (`refs/redline/keep/<sha>`) while the mirror lasts.
 * Git runs with every repository-controlled hook off.
 */
export class GitMirrors implements SourceRepository, SourceTrees {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly options: GitMirrorsOptions) {}

  async prepare(repository: RepositoryRef, sha: string | null): Promise<Publishing<string>> {
    return attempt(() =>
      this.locked(repository, async (mirror) => {
        if (sha !== null && (await this.holds(mirror, sha))) return ok(sha);
        const reached = await this.reached(repository, this.options.remotes.source(repository));
        if (!reached.ok) return reached;
        const remote = reached.value;
        const exists = await access(mirror).then(
          () => true,
          () => false,
        );
        if (!exists) {
          await mkdir(mirror, { recursive: true });
          await git(mirror, ['init', '--quiet', '--bare']);
        }
        // Fetched by URL each time: the mirror keeps no remote, and so no credentials.
        await git(
          mirror,
          ['fetch', '--prune', '--quiet', remote.url, '+refs/heads/*:refs/heads/*'],
          reaching(remote),
        );
        const wanted =
          sha ??
          (await git(mirror, [
            'for-each-ref',
            '--format=%(objectname)',
            `refs/heads/${repository.baseBranch}`,
          ]));
        if (wanted === '') {
          return fail(`${repository.name} has no branch ${repository.baseBranch}`, false);
        }
        if (!(await this.holds(mirror, wanted))) {
          // No branch reaches it any more: the host may still give it by its name (GitHub does
          // until it collects it). A host that just answered for its branches and does not give
          // the commit has not got it.
          const given = await git(
            mirror,
            ['-c', 'protocol.version=2', 'fetch', '--quiet', remote.url, wanted],
            reaching(remote),
          ).then(
            () => true,
            () => false,
          );
          if (!given || !(await this.holds(mirror, wanted))) {
            return fail(`${repository.name} no longer has the commit ${wanted}`, false);
          }
        }
        await git(mirror, ['update-ref', keepRef(wanted), wanted]);
        return ok(wanted);
      }),
    );
  }

  async settings(repository: RepositoryRef, sha: string): Promise<Publishing<RepositorySettings>> {
    const prepared = await this.prepare(repository, sha);
    if (!prepared.ok) return prepared;
    return attempt(async () => {
      const parsed = parseRepositorySettings(
        await this.fileAt(repository, sha, REPOSITORY_SETTINGS),
      );
      return parsed.ok ? ok(parsed.value) : fail(parsed.detail, false);
    });
  }

  /** The head of the repository's base branch, read from its host: whether the mirrors reach it. */
  async reach(repository: RepositoryRef): Promise<Publishing<string>> {
    return attempt(async () => {
      const reached = await this.reached(repository, this.options.remotes.source(repository));
      if (!reached.ok) return reached;
      const remote = reached.value;
      const listed = await git(
        tmpdir(),
        ['ls-remote', remote.url, `refs/heads/${repository.baseBranch}`],
        reaching(remote),
      );
      const sha = listed.split(/\s/)[0] ?? '';
      return sha === ''
        ? fail(`${repository.name} has no branch ${repository.baseBranch}`, false)
        : ok(sha);
    });
  }

  async workingCopy(repository: RepositoryRef, sha: string): Promise<ReadableStream<Uint8Array>> {
    const prepared = await this.prepare(repository, sha);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const mirror = this.mirrorOf(repository);
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-copy-'));
    const copy = path.join(scratch, 'workspace');
    try {
      await git(scratch, ['init', '--quiet', copy]);
      await git(copy, [
        'fetch',
        '--quiet',
        `--depth=${String(WORKSPACE_DEPTH)}`,
        `file://${mirror}`,
        keepRef(sha),
      ]);
      await git(copy, ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    } catch (error) {
      await rm(scratch, { recursive: true, force: true });
      throw error;
    }
    const archive = streamOf('tar', ['-C', copy, '-cf', '-', '.'], scratch);
    archive.on('close', () => {
      void rm(scratch, { recursive: true, force: true });
    });
    return Readable.toWeb(archive) as ReadableStream<Uint8Array>;
  }

  /**
   * A file of the repository at `sha`, or null when the tree has none there. Failing to read
   * the mirror is an error, never taken for a missing file.
   */
  private async fileAt(
    repository: RepositoryRef,
    sha: string,
    file: string,
  ): Promise<string | null> {
    const mirror = this.mirrorOf(repository);
    const listed = await git(mirror, ['ls-tree', '--object-only', sha, '--', file]);
    if (listed === '') return null;
    return git(mirror, ['cat-file', 'blob', listed]);
  }

  /** The remote a host gives for a repository, or why there is none. */
  private async reached(
    repository: RepositoryRef,
    found: Promise<Publishing<GitRemote | null>>,
  ): Promise<Publishing<GitRemote>> {
    const remote = await found;
    if (!remote.ok) return remote;
    return remote.value === null
      ? fail(`No git host ${repository.host} is configured`, false)
      : ok(remote.value);
  }

  async describe(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<ChangeDescription>> {
    const imported = await this.importChange(repository, baseSha, change);
    if (!imported.ok) return imported;
    const head = imported.value;
    return attempt(async () => {
      const [diff, secrets] = await Promise.all([
        this.diffOf(repository, baseSha, head),
        this.options.secrets.find(this.mirrorOf(repository), baseSha, head),
      ]);
      return secrets.ok ? ok({ ...diff, secrets: secrets.value }) : secrets;
    });
  }

  /** What every file of `baseSha..head` becomes, and the scripts it changes. */
  private async diffOf(
    repository: RepositoryRef,
    baseSha: string,
    head: string,
  ): Promise<Omit<ChangeDescription, 'secrets'>> {
    const mirror = this.mirrorOf(repository);
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
    return { entries, scriptChanges };
  }

  async commit(
    repository: RepositoryRef,
    commit: DeterministicCommit,
  ): Promise<Publishing<{ readonly sha: string }>> {
    return attempt(async () => {
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
      await git(mirror, ['update-ref', keepRef(sha), sha]);
      return ok({ sha });
    });
  }

  async push(
    repository: RepositoryRef,
    publishing: PublishingProfile,
    sha: string,
    branch: string,
  ) {
    const mirror = this.mirrorOf(repository);
    return attempt(async () => {
      const reached = await this.reached(
        repository,
        this.options.remotes.target(repository, publishing),
      );
      if (!reached.ok) return reached;
      const remote = reached.value;
      const env = reaching(remote);
      const listed = await git(mirror, ['ls-remote', remote.url, `refs/heads/${branch}`], env);
      const current = listed.split(/\s/)[0] ?? '';
      if (current === sha) return ok(undefined);
      if (current !== '') return fail(`The branch ${branch} moved to ${current}`, false);
      await git(
        mirror,
        [
          'push',
          '--quiet',
          `--force-with-lease=refs/heads/${branch}:`,
          remote.url,
          `${sha}:refs/heads/${branch}`,
        ],
        env,
      );
      return ok(undefined);
    });
  }

  /**
   * Takes a change bundle into the mirror: one commit, the one the run named, whose parent is
   * the base, which is fetched again if the mirror lost it. A bundle is checked and stored once
   * (it is stored by its content's hash), and each later import of it only checks the commit.
   */
  private async importChange(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<string>> {
    const base = await this.prepare(repository, baseSha);
    if (!base.ok) return base;
    return attempt(() =>
      this.locked(repository, (mirror) => this.importInto(mirror, baseSha, change)),
    );
  }

  private async importInto(
    mirror: string,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<string>> {
    const ref = `refs/redline/changes/${change.blob}`;
    if ((await git(mirror, ['for-each-ref', '--format=%(objectname)', ref])) === '') {
      const stored = await this.storeChange(mirror, ref, change);
      if (!stored.ok) return stored;
    }
    const head = await git(mirror, ['rev-parse', ref]);
    if (head !== change.head) {
      return fail(`The change bundle carries ${head}, not the commit the run named`, false);
    }
    const parents = (await git(mirror, ['rev-list', '--parents', '-n', '1', head]))
      .split(' ')
      .slice(1);
    if (parents.length !== 1 || parents[0] !== baseSha) {
      return fail('The change is not one commit on the task’s base', false);
    }
    return ok(head);
  }

  /** Checks a change bundle's objects and fetches it into the mirror at `ref`. */
  private async storeChange(
    mirror: string,
    ref: string,
    change: ChangeRef,
  ): Promise<Publishing<undefined>> {
    const bytes = await this.options.blobs.read(change.blob);
    if (bytes === null) return fail('The change is no longer stored', false);
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-change-'));
    try {
      const file = path.join(scratch, 'change.bundle');
      await writeFile(file, bytes);
      try {
        await git(mirror, ['bundle', 'verify', '--quiet', file]);
        await this.inspectObjects(mirror, scratch, bytes);
      } catch (error) {
        return fail(`The change is not a git bundle of this repository: ${String(error)}`, false);
      }
      try {
        await git(mirror, ['fetch', '--quiet', '--no-tags', file, `+${BUNDLE_REF}:${ref}`]);
      } catch (error) {
        // The bundle is sound: storing it failed (the disk), and may not next time.
        return fail(`The change could not be stored in the mirror: ${String(error)}`, true);
      }
      return ok(undefined);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /**
   * Checks every object of a bundle as strictly as git checks what it receives, in a quarantine
   * that sees the mirror's objects and adds none to it: the bundle is the sandbox's, and its
   * objects go on to be committed and pushed. Fetching a bundle checks nothing of the sort.
   */
  private async inspectObjects(mirror: string, scratch: string, bundle: Uint8Array) {
    const quarantine = path.join(scratch, 'quarantine.git');
    await git(scratch, ['init', '--quiet', '--bare', quarantine]);
    await writeFile(
      path.join(quarantine, 'objects', 'info', 'alternates'),
      `${path.resolve(mirror, 'objects')}\n`,
    );
    await git(quarantine, ['index-pack', '--strict', '--stdin', '--fix-thin'], {}, packOf(bundle));
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

  /** Whether the mirror has the commit `sha`. */
  private async holds(mirror: string, sha: string): Promise<boolean> {
    return git(mirror, ['cat-file', '-e', `${sha}^{commit}`]).then(
      () => true,
      () => false,
    );
  }

  /** Where the mirror of `repository` is. */
  mirrorOf(repository: RepositoryRef): string {
    const safe = (part: string) => part.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.options.root, safe(repository.host), `${safe(repository.name)}.git`);
  }

  /**
   * Fetches into a mirror (preparing it, taking a change in), one at a time in this process: a
   * worker publishes one change of a project at a time, so this is all that writes there at once.
   */
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
