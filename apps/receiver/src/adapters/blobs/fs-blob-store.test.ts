import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlobDigest } from '../../domain/ids';
import { FsBlobStore } from './fs-blob-store';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'redline-blobs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('FsBlobStore', () => {
  it('stores a file under the SHA-256 of what was written, in chunks', async () => {
    const store = new FsBlobStore(root);
    const writer = store.writer();
    await writer.write(bytes('hello '));
    await writer.write(bytes('world'));
    const stored = await writer.commit();
    expect(stored).toEqual({ digest: sha('hello world'), bytes: 11 });
    expect(new TextDecoder().decode((await store.read(stored.digest)) ?? new Uint8Array())).toBe(
      'hello world',
    );
    expect(await store.has(stored.digest)).toBe(true);
    expect(await readdir(path.join(root, 'incoming'))).toEqual([]);
  });

  it('stores the same bytes once', async () => {
    const store = new FsBlobStore(root);
    for (let i = 0; i < 2; i += 1) {
      const writer = store.writer();
      await writer.write(bytes('same'));
      await writer.commit();
    }
    expect(await readdir(path.join(root, sha('same').slice(0, 2)))).toEqual([sha('same')]);
  });

  it('leaves nothing of a discarded file', async () => {
    const store = new FsBlobStore(root);
    const writer = store.writer();
    await writer.write(bytes('half'));
    await writer.discard();
    expect(await readdir(path.join(root, 'incoming'))).toEqual([]);
    expect(await store.has(BlobDigest(sha('half')))).toBe(false);
  });

  it('answers unknown and malformed digests with nothing', async () => {
    const store = new FsBlobStore(root);
    expect(await store.read(BlobDigest('f'.repeat(64)))).toBeNull();
    expect(await store.read(BlobDigest('../../etc/passwd'))).toBeNull();
  });
});
