import { bundleManifestSchema } from '@redline/contract';
import { BlobDigest } from '../../domain/ids';
import type { BlobStore, BundleContents, BundleReader } from '../../ports/bundles';

/** Bundles kept in the blob store, read through their `manifest.json` (`bundle.v1`). */
export class StoredBundles implements BundleReader {
  constructor(private readonly blobs: BlobStore) {}

  async read(manifest: BlobDigest): Promise<BundleContents | null> {
    const bytes = await this.blobs.read(manifest);
    if (bytes === null) return null;
    const parsed = bundleManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) {
      throw new Error(
        `Stored manifest ${manifest} is not a bundle.v1 manifest: ${parsed.error.message}`,
      );
    }
    const { steps, files, entry } = parsed.data;
    return {
      steps: steps.map((step) => ({
        id: step.id,
        url: step.url,
        comment: step.comment,
        viewport: { width: step.viewport.width, height: step.viewport.height },
      })),
      files: files.map((file) => ({
        path: file.path,
        digest: BlobDigest(file.sha256),
        mediaType: file.mediaType,
      })),
      entry,
    };
  }
}
