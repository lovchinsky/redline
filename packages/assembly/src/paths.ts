import type { AssetRef, DetailFile } from '@redline/core';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};

export interface FileOwner {
  readonly stepId: string;
  readonly shapeId: string | null;
}

export type FileContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'asset'; readonly asset: AssetRef };

export interface RenderedFile {
  readonly path: string;
  readonly mediaType: string;
  readonly content: FileContent;
  /** The area (or step) the file belongs to; `null` for task-wide files. */
  readonly owner: FileOwner | null;
}

/**
 * Assigns readable, collision-free bundle paths:
 * `assets/step-1/area-2-crop.png`, `details/step-1/area-2-dom.html`.
 */
export class BundlePaths {
  private readonly files = new Map<string, RenderedFile>();
  private readonly assetPaths = new Map<string, string>();
  private readonly detailPaths = new Map<string, string>();

  scope(stepIndex: number, areaIndex: number | null, owner: FileOwner) {
    const prefix = `step-${String(stepIndex)}`;
    const area = areaIndex === null ? '' : `area-${String(areaIndex)}-`;
    return {
      asset: (asset: AssetRef, role: string): string => {
        const existing = this.assetPaths.get(asset.id);
        if (existing !== undefined) return existing;
        const extension = EXTENSIONS[asset.mediaType] ?? 'bin';
        const path = this.unique(`assets/${prefix}/${area}${slug(role)}`, extension);
        this.assetPaths.set(asset.id, path);
        this.files.set(path, {
          path,
          mediaType: asset.mediaType,
          content: { kind: 'asset', asset },
          owner,
        });
        return path;
      },
      // The same file asked for twice gets one path; another file with the same name gets
      // a path of its own instead of being lost.
      detail: (file: DetailFile): string => {
        const base = `details/${prefix}/${area}${slug(file.name)}`;
        const identity = `${base}\u0000${file.extension}\u0000${file.content}`;
        const existing = this.detailPaths.get(identity);
        if (existing !== undefined) return existing;
        const path = this.unique(base, file.extension);
        this.detailPaths.set(identity, path);
        this.files.set(path, {
          path,
          mediaType: file.mediaType,
          content: { kind: 'text', text: file.content },
          owner,
        });
        return path;
      },
    };
  }

  all(): readonly RenderedFile[] {
    return [...this.files.values()];
  }

  private unique(base: string, extension: string): string {
    let path = `${base}.${extension}`;
    for (let n = 2; this.files.has(path); n += 1) path = `${base}-${String(n)}.${extension}`;
    return path;
  }
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'file';
