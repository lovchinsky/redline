import { appError, err, ok, type AppError, type Result } from '@redline/core';
import { zip, type AsyncZippable } from 'fflate';
import type { BundleArchiver } from '../../ports/drafts';

/** Images are already compressed; deflating them again only costs time. */
const isCompressed = (mediaType: string) => mediaType.startsWith('image/');

/** `.zip` with `manifest.json` at the root and every file under its bundle path. */
export class ZipBundleArchiver implements BundleArchiver {
  async archive(bundle: Parameters<BundleArchiver['archive']>[0]): Promise<Result<Blob, AppError>> {
    const entries: AsyncZippable = {
      'manifest.json': [
        new TextEncoder().encode(`${JSON.stringify(bundle.manifest, null, 2)}\n`),
        { level: 6 },
      ],
    };
    for (const [path, blob] of bundle.files) {
      entries[path] = [
        new Uint8Array(await blob.arrayBuffer()),
        { level: isCompressed(blob.type) ? 0 : 6 },
      ];
    }
    return new Promise((resolve) => {
      zip(entries, (error, data) => {
        resolve(
          error === null
            ? ok(new Blob([data], { type: 'application/zip' }))
            : err(appError('internal', 'Could not pack the bundle', { message: error.message })),
        );
      });
    });
  }
}
