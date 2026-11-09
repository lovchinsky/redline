import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsBlobStore } from './fs-blob-store';
import { StoredBundles } from './stored-bundles';

let root: string;
let blobs: FsBlobStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'redline-bundles-'));
  blobs = new FsBlobStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const store = async (bytes: Uint8Array) => {
  const writer = blobs.writer();
  await writer.write(bytes);
  return writer.commit();
};

const CONTEXT = new TextEncoder().encode('# Redline task\n');

const manifestOf = (file: { digest: string; bytes: number }) =>
  new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      taskId: 'draft-1',
      createdAt: '2026-11-09T10:00:00.000Z',
      client: { version: '0.1.0' },
      steps: [
        {
          id: 'step-1',
          url: 'https://staging.acme.io/pricing',
          routePattern: '/pricing',
          comment: 'Rename the badge',
          viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
          shapes: [{ id: 'shape-1', files: ['context.md'] }],
        },
      ],
      files: [
        { path: 'context.md', mediaType: 'text/markdown', sha256: file.digest, bytes: file.bytes },
      ],
      entry: 'context.md',
    }),
  );

describe('StoredBundles', () => {
  it('reads a bundle whose files are all stored, and none that lost one', async () => {
    const context = await store(CONTEXT);
    const manifest = await store(manifestOf(context));
    expect(await new StoredBundles(blobs).read(manifest.digest)).toMatchObject({
      steps: [{ id: 'step-1', files: ['context.md'] }],
      files: [{ path: 'context.md', digest: context.digest }],
      entry: 'context.md',
    });

    const lost = await store(manifestOf({ digest: 'e'.repeat(64), bytes: 1 }));
    expect(await new StoredBundles(blobs).read(lost.digest)).toBeNull();
    expect(await new StoredBundles(blobs).read('f'.repeat(64) as never)).toBeNull();
  });
});
