import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { BlobDigest, isBlobDigest } from '../../domain/ids';
import type { BlobStore, BlobWriter } from '../../ports/bundles';

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Blobs as files named by their SHA-256, under two-character directories. A file is written
 * under a temporary name, flushed to disk and renamed into place: a reader never sees half a
 * file, and a crash leaves at most a temporary file for garbage collection.
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private pathOf(digest: BlobDigest): string {
    return path.join(this.root, digest.slice(0, 2), digest);
  }

  writer(): BlobWriter {
    const temporary = path.join(this.root, 'incoming', randomBytes(12).toString('hex'));
    const hash = createHash('sha256');
    let bytes = 0;
    const handle = mkdir(path.dirname(temporary), { recursive: true }).then(() =>
      open(temporary, 'wx'),
    );
    return {
      write: async (chunk) => {
        hash.update(chunk);
        bytes += chunk.byteLength;
        await (await handle).write(chunk);
      },
      commit: async () => {
        const file = await handle;
        await file.sync();
        await file.close();
        const digest = BlobDigest(hash.digest('hex'));
        const target = this.pathOf(digest);
        await mkdir(path.dirname(target), { recursive: true });
        await rename(temporary, target);
        return { digest, bytes };
      },
      discard: async () => {
        await (await handle).close().catch(() => undefined);
        await rm(temporary, { force: true });
      },
    };
  }

  async read(digest: BlobDigest): Promise<Uint8Array | null> {
    if (!isBlobDigest(digest)) return null;
    try {
      return await readFile(this.pathOf(digest));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async has(digest: BlobDigest): Promise<boolean> {
    if (!isBlobDigest(digest)) return false;
    try {
      await stat(this.pathOf(digest));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
}
