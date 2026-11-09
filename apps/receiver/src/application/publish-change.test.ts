import { describe, expect, it } from 'vitest';
import type { BlobDigest } from '../domain/ids';
import { fenced, taskMarker } from './change-request';
import { never, system } from './testing/system';

const outcome = {
  kind: 'change' as const,
  change: { blob: 'c'.repeat(64) as BlobDigest, head: 'b'.repeat(40) },
  report: {
    summary: 'Renamed the badge. Closes #12, thanks @everyone <!-- redline-task:other -->',
    changes: [{ file: 'src/PlanCard.tsx', why: 'the badge text lives here' }],
    verification: 'Unit tests pass',
    assumptions: ['Desktop and mobile both change'],
  },
};

const publishing = async () => {
  const app = system();
  const task = await app.submit();
  app.runner.outcomes.push(outcome);
  await app.supervise.handle(task.id, never);
  return { app, task };
};

describe('PublishChange', () => {
  it('commits, pushes to the task’s branch and opens a change request', async () => {
    const { app, task } = await publishing();
    await app.publish.handle(task.id);

    expect(app.git.commits).toEqual([
      {
        taskId: task.id,
        baseSha: 'base-sha',
        change: outcome.change,
        message: `Redline: ${task.bundle.title}\n\nRedline-Task: ${task.id}\nRequested-by: Ann Lee <ann@example.com>\n`,
        at: task.createdAt,
      },
    ]);
    expect(app.git.pushes).toEqual([{ sha: `sha-of-${task.id}`, branch: `redline/${task.id}` }]);
    const [draft] = app.git.opened;
    expect(draft).toMatchObject({
      branch: `redline/${task.id}`,
      title: `Redline: ${task.bundle.title}`,
      draft: true,
      labels: ['redline'],
    });
    expect(app.store.task(task.id).state).toEqual({
      kind: 'published',
      changeRequest: { id: '1', url: 'https://git.example/acme/web/pull/1' },
    });
  });

  it('quotes the agent’s words so nothing in them is acted on, and marks the task itself', async () => {
    const { app, task } = await publishing();
    await app.publish.handle(task.id);
    const body = app.git.opened[0]?.body ?? '';
    expect(body).toContain(fenced(outcome.report.summary));
    expect(body).toContain(fenced('src/PlanCard.tsx: the badge text lives here'));
    expect(body.trimEnd().endsWith(taskMarker(task))).toBe(true);
    // The only marker outside a fenced block is the receiver's own.
    const outside = body.split(/```text\n[\s\S]*?\n```/).join('');
    expect(outside.match(/redline-task:/g)).toHaveLength(1);
  });

  it('finds the change request a crashed attempt already opened instead of opening another', async () => {
    const { app, task } = await publishing();
    app.git.failures.set('findOpen', { transient: true, detail: 'timeout' });
    await app.git.open(null, null, {
      branch: `redline/${task.id}`,
      title: 't',
      body: 'b',
      draft: true,
      labels: [],
    });
    await app.publish.handle(task.id);
    expect(app.store.task(task.id).publishAttempts).toBe(1);
    await app.publish.handle(task.id);
    expect(app.git.opened).toHaveLength(1);
    expect(app.store.task(task.id).state.kind).toBe('published');
  });

  it('retries a transient failure later and gives up after the project’s attempts', async () => {
    const { app, task } = await publishing();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      app.git.failures.set('push', { transient: true, detail: '503 from the git host' });
      await app.publish.handle(task.id);
    }
    expect(app.store.jobsOf('publish').map((entry) => entry.startAfter)).toEqual([
      null,
      2_000,
      3_000,
    ]);
    expect(app.store.task(task.id).state).toEqual({
      kind: 'failed',
      failure: {
        code: 'publish-failed',
        message: 'The change could not be published: 503 from the git host',
      },
    });
  });

  it('rejects a change that breaks the policy without committing it', async () => {
    const { app, task } = await publishing();
    app.git.description = {
      entries: [
        {
          path: '.github/workflows/ci.yml',
          previousPath: null,
          status: 'modified',
          mode: 'file',
          binary: false,
          bytes: 1,
          addedLines: 1,
          removedLines: 0,
        },
      ],
      scriptChanges: [],
    };
    app.git.secrets = [{ path: '.github/workflows/ci.yml', line: 1, rule: 'github-token' }];
    await app.publish.handle(task.id);
    expect(app.git.commits).toEqual([]);
    expect(app.store.task(task.id).state).toEqual({
      kind: 'failed',
      failure: {
        code: 'policy-rejected',
        message:
          'The change was rejected by the project policy: .github/workflows/ci.yml is protected (.github); .github/workflows/ci.yml:1 looks like a secret (github-token)',
      },
    });
  });

  it('labels a change that needs a reviewer’s attention', async () => {
    const { app, task } = await publishing();
    app.git.description = {
      entries: [
        {
          path: 'package.json',
          previousPath: null,
          status: 'modified',
          mode: 'file',
          binary: false,
          bytes: 1,
          addedLines: 1,
          removedLines: 1,
        },
      ],
      scriptChanges: [{ path: 'package.json', scripts: ['postinstall'] }],
    };
    await app.publish.handle(task.id);
    expect(app.git.opened[0]?.labels).toEqual(['redline', 'redline:needs-attention']);
    expect(app.git.opened[0]?.body).toContain('## Needs attention');
  });

  it('closes the change request when the task was cancelled while it was being opened', async () => {
    const { app, task } = await publishing();
    const open = app.git.open.bind(app.git);
    app.git.open = async (...args) => {
      const opened = await open(...args);
      await app.operations.cancel(task.id, 'changed my mind');
      return opened;
    };
    await app.publish.handle(task.id);
    expect(app.store.task(task.id).state.kind).toBe('cancelled');
    // The cancellation's withdrawal looked before the change request existed: it looks again.
    expect(app.store.jobsOf('withdraw-change')).toHaveLength(2);
    await app.withdraw.handle(task.id);
    expect(app.git.closed).toEqual([{ id: '1', url: 'https://git.example/acme/web/pull/1' }]);
  });

  it('withdraws the change request of a task cancelled after publishing began', async () => {
    const { app, task } = await publishing();
    await app.git.open(null, null, {
      branch: `redline/${task.id}`,
      title: 't',
      body: 'b',
      draft: true,
      labels: [],
    });
    await app.operations.cancel(task.id, 'stop');
    expect(app.store.jobsOf('withdraw-change')).toHaveLength(1);
    await app.withdraw.handle(task.id);
    expect(app.git.closed).toHaveLength(1);
  });

  it('does nothing for a task that is not publishing', async () => {
    const { app, task } = await publishing();
    await app.publish.handle(task.id);
    await app.publish.handle(task.id);
    expect(app.git.opened).toHaveLength(1);
    expect(app.git.commits).toHaveLength(1);
  });
});

describe('fenced', () => {
  it('fences text with a fence longer than any backtick run inside it', () => {
    expect(fenced('plain')).toBe('```text\nplain\n```');
    expect(fenced('a ```` b')).toBe('`````text\na ```` b\n`````');
  });
});
