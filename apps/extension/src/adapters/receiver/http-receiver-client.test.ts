import { startMockReceiver, type MockReceiver } from '@redline/mock-receiver';
import { BUNDLE_ENTRY, BUNDLE_SCHEMA_VERSION } from '@redline/contract';
import { ProjectId, type Result } from '@redline/core';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Submission } from '../../ports/delivery';
import { StorageSettingsStore } from '../storage/storage-settings';
import { memoryStorageArea } from '../storage/storage-area';
import { HttpReceiverClient } from './http-receiver-client';

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const delivery = (): Submission => {
  const context = '# Redline task\n';
  return {
    projectId: ProjectId.parse('acme-web'),
    idempotencyKey: 'delivery-1',
    bundle: {
      digest: 'd'.repeat(64),
      files: new Map([[BUNDLE_ENTRY, new Blob([context], { type: 'text/markdown' })]]),
      manifest: {
        schemaVersion: BUNDLE_SCHEMA_VERSION,
        taskId: 'task-1',
        createdAt: '2026-11-05T10:00:00.000Z',
        client: { version: '0.1.0' },
        steps: [
          {
            id: 's1',
            url: 'https://acme.io/',
            routePattern: '/',
            comment: 'Fix',
            viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
            shapes: [{ id: 'a', files: [] }],
          },
        ],
        files: [
          {
            path: BUNDLE_ENTRY,
            mediaType: 'text/markdown',
            sha256: createHash('sha256').update(context).digest('hex'),
            bytes: context.length,
          },
        ],
        entry: BUNDLE_ENTRY,
      },
    },
  };
};

let receiver: MockReceiver;
let client: HttpReceiverClient;
let settings: StorageSettingsStore;

beforeEach(async () => {
  receiver = await startMockReceiver({ token: 'secret' });
  settings = new StorageSettingsStore(memoryStorageArea());
  value(await settings.setReceiver({ baseUrl: receiver.url, token: 'secret' }));
  client = new HttpReceiverClient(settings, (input, init) => fetch(input, init));
});

afterEach(async () => {
  await receiver.close();
});

describe('HttpReceiverClient against the mock receiver', () => {
  it('lists projects and delivers a bundle whose files match the manifest', async () => {
    expect(value(await client.listProjects())).toEqual([{ id: 'acme-web', name: 'Acme Web' }]);
    const report = value(await client.submit(delivery()));
    expect(report).toEqual({ remoteId: 'remote-1', status: { phase: 'queued' }, pollAfterSec: 1 });
    const [task] = receiver.tasks.values();
    expect(task?.projectId).toBe('acme-web');
    expect(task?.files.get(BUNDLE_ENTRY)?.toString()).toBe('# Redline task\n');
  });

  it('follows the status, answers a question and reaches the result', async () => {
    const { remoteId } = value(await client.submit(delivery()));
    expect(value(await client.getTask(remoteId)).status.phase).toBe('working');
    const asking = value(await client.getTask(remoteId));
    if (asking.status.phase !== 'needs-input') throw new Error('expected a question');
    const answered = value(
      await client.reply(remoteId, { questionId: asking.status.question.id, text: 'Yes' }),
    );
    expect(answered.status.phase).toBe('working');
    expect(value(await client.getTask(remoteId)).status).toEqual({
      phase: 'result-ready',
      resultUrl: 'https://git.example/acme/web/pull/42',
    });
  });

  it('a repeated delivery with the same key returns the same task, never a second one', async () => {
    receiver.fail('drop-after-accept');
    const lost = await client.submit(delivery());
    expect(lost).toMatchObject({ ok: false, error: { code: 'receiver-unavailable' } });
    const retried = value(await client.submit(delivery()));
    expect(retried.remoteId).toBe('remote-1');
    expect(receiver.tasks.size).toBe(1);
    expect(receiver.submissions()).toBe(2);
  });

  it('maps failures: unavailable with Retry-After, bad token, rejected bundle, not configured', async () => {
    receiver.fail('unavailable');
    expect(await client.listProjects()).toMatchObject({
      ok: false,
      error: { code: 'receiver-unavailable', details: { status: 503, retryAfterSec: 1 } },
    });

    value(await settings.setReceiver({ baseUrl: receiver.url, token: 'wrong' }));
    expect(await client.listProjects()).toMatchObject({
      ok: false,
      error: { code: 'permission-denied' },
    });

    value(await settings.setReceiver({ baseUrl: receiver.url, token: 'secret' }));
    const tampered = delivery();
    const wrongProject = { ...tampered, projectId: ProjectId.parse('nope') };
    expect(await client.submit(wrongProject)).toMatchObject({
      ok: false,
      error: { code: 'validation', details: { status: 422 } },
    });

    value(await settings.setReceiver(null));
    expect(await client.listProjects()).toMatchObject({
      ok: false,
      error: { code: 'not-configured' },
    });
  });

  it('repeats an answer safely: the same answer again changes nothing', async () => {
    const { remoteId } = value(await client.submit(delivery()));
    value(await client.getTask(remoteId));
    const asking = value(await client.getTask(remoteId));
    if (asking.status.phase !== 'needs-input') throw new Error('expected a question');
    const answer = { questionId: asking.status.question.id, text: 'Yes' };
    const first = value(await client.reply(remoteId, answer));
    expect(value(await client.reply(remoteId, answer))).toEqual(first);
    expect([...receiver.tasks.values()][0]?.replies).toHaveLength(1);
  });

  it('calls a task unknown only when the receiver says so, not for any 404', async () => {
    expect(await client.getTask('remote-404')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    // A wrong address answers 404 for everything: that is a receiver to fix, not a lost task.
    value(await settings.setReceiver({ baseUrl: `${receiver.url}/wrong`, token: 'secret' }));
    expect(await client.getTask('remote-1')).toMatchObject({
      ok: false,
      error: { code: 'receiver-unavailable', details: { status: 404 } },
    });
  });

  it('reports an unreachable receiver', async () => {
    await receiver.close();
    expect(await client.getTask('remote-1')).toMatchObject({
      ok: false,
      error: { code: 'receiver-unavailable' },
    });
    receiver = await startMockReceiver();
  });
});
