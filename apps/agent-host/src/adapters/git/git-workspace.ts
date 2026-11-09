import { CHANGE_REF } from '@redline/agent-protocol';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceChange } from '../../domain/outcome';
import type { Workspace } from '../../ports/run';

const run = promisify(execFile);

/** The change is the receiver's to commit: this commit only carries the tree. */
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
  constructor(private readonly options: { readonly root: string; readonly bundlePath: string }) {}

  async exportChange(baseSha: string): Promise<WorkspaceChange> {
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-index-'));
    // A fresh index: every file the repository does not ignore, whatever the agent staged.
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
            GIT_INDEX_FILE: path.join(scratch, 'index'),
            GIT_CONFIG_NOSYSTEM: '1',
            ...IDENTITY,
          },
          maxBuffer: 16 * 1024 * 1024,
        },
      ).then(({ stdout }) => stdout.trim());
    try {
      await git(['add', '--all', '--', '.']);
      const tree = await git(['write-tree']);
      const baseTree = await git(['rev-parse', `${baseSha}^{tree}`]);
      if (tree === baseTree) return null;
      const head = await git(['commit-tree', tree, '-p', baseSha, '-m', 'Redline change']);
      await git(['update-ref', CHANGE_REF, head]);
      await git(['bundle', 'create', this.options.bundlePath, CHANGE_REF, `^${baseSha}`]);
      return { head };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
