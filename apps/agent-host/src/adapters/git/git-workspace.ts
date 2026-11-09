import { CHANGE_REF, WORK_REF } from '@redline/agent-protocol';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceChange } from '../../domain/outcome';
import type { Workspace } from '../../ports/run';

const run = promisify(execFile);

/** The receiver commits the change itself: these commits only carry a tree. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Redline agent',
  GIT_AUTHOR_EMAIL: 'agent@redline.invalid',
  GIT_AUTHOR_DATE: '1970-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'Redline agent',
  GIT_COMMITTER_EMAIL: 'agent@redline.invalid',
  GIT_COMMITTER_DATE: '1970-01-01T00:00:00Z',
};

/**
 * The working copy as git sees it. The agent had a shell in it, so nothing it may have set in
 * the repository's configuration runs here: no hooks, no fsmonitor, no other index.
 */
export class GitWorkspace implements Workspace {
  constructor(
    private readonly options: {
      readonly root: string;
      /** Where the change goes (`RUN_OUTPUTS.change`). */
      readonly changeBundle: string;
      /** Where the work of a pausing run goes (`RUN_OUTPUTS.work`). */
      readonly workBundle: string;
      /** Where the work of the paused run a resuming run goes on with is (`RUN_LAYOUT.work`). */
      readonly pausedWork: string;
    },
  ) {}

  exportChange(baseSha: string): Promise<WorkspaceChange> {
    return this.export(baseSha, CHANGE_REF, 'Redline change', this.options.changeBundle);
  }

  exportWork(baseSha: string): Promise<WorkspaceChange> {
    return this.export(baseSha, WORK_REF, 'Redline work in progress', this.options.workBundle);
  }

  /**
   * The working tree becomes the work's tree, with what the setup installed (ignored files)
   * left as it is; `HEAD` and the index stay at the base, as they were for the paused run.
   */
  async restoreWork(baseSha: string, head: string): Promise<void> {
    await this.withGit(null, async (git) => {
      await git([
        'fetch',
        '--quiet',
        '--no-tags',
        this.options.pausedWork,
        `+${WORK_REF}:${WORK_REF}`,
      ]);
      const fetched = await git(['rev-parse', '--verify', `${WORK_REF}^{commit}`]);
      if (fetched !== head) throw new Error(`The paused work is at ${fetched}, not ${head}`);
      const parent = await git(['rev-parse', '--verify', `${head}^`]);
      if (parent !== baseSha) throw new Error('The paused work is not on the task’s base');
      await git(['read-tree', '--reset', '-u', head]);
      await git(['reset', '--quiet', '--mixed', baseSha]);
    });
  }

  /** One commit on `baseSha` with every file the repository does not ignore, or null. */
  private export(
    baseSha: string,
    ref: string,
    message: string,
    bundle: string,
  ): Promise<WorkspaceChange> {
    // A fresh index: every file the repository does not ignore, whatever the agent staged.
    return this.withGit('scratch', async (git) => {
      await git(['add', '--all', '--', '.']);
      const tree = await git(['write-tree']);
      const baseTree = await git(['rev-parse', `${baseSha}^{tree}`]);
      if (tree === baseTree) return null;
      const head = await git(['commit-tree', tree, '-p', baseSha, '-m', message]);
      await git(['update-ref', ref, head]);
      await git(['bundle', 'create', bundle, ref, `^${baseSha}`]);
      return { head };
    });
  }

  /** Runs `work` with git in the workspace: on its own index, or a scratch one. */
  private async withGit<T>(
    index: 'scratch' | null,
    work: (git: (args: readonly string[]) => Promise<string>) => Promise<T>,
  ): Promise<T> {
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-git-'));
    const git = (args: readonly string[]) =>
      run(
        'git',
        [
          '-c',
          `safe.directory=${this.options.root}`,
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          ...args,
        ],
        {
          cwd: this.options.root,
          env: {
            PATH: process.env['PATH'],
            HOME: scratch,
            GIT_CONFIG_NOSYSTEM: '1',
            ...(index === 'scratch' ? { GIT_INDEX_FILE: path.join(scratch, 'index') } : {}),
            ...IDENTITY,
          },
          maxBuffer: 16 * 1024 * 1024,
        },
      ).then(({ stdout }) => stdout.trim());
    try {
      return await work(git);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
