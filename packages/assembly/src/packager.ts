import {
  BUNDLE_ENTRY,
  BUNDLE_SCHEMA_VERSION,
  bundleManifestSchema,
  type BundleFile,
  type BundleManifest,
  type Viewport,
} from '@redline/contract';
import {
  appError,
  err,
  ok,
  parseWith,
  type AppError,
  type AssetId,
  type Result,
} from '@redline/core';
import type { RenderedContext } from './renderer';

export interface PackageStep {
  readonly id: string;
  readonly url: string;
  readonly routePattern: string;
  readonly comment: string;
  readonly viewport: Viewport;
  readonly shapeIds: readonly string[];
}

export interface PackageInput {
  readonly taskId: string;
  readonly createdAt: string;
  readonly clientVersion: string;
  readonly steps: readonly PackageStep[];
  readonly rendered: RenderedContext;
}

export interface Bundle {
  readonly manifest: BundleManifest;
  /** Every file listed in the manifest, keyed by bundle path. */
  readonly files: ReadonlyMap<string, Blob>;
  /**
   * SHA-256 over the files' paths and hashes. Identifies the content: two bundles with the
   * same digest carry the same bytes, whenever they were assembled.
   */
  readonly digest: string;
}

export interface AssetSource {
  get(id: AssetId): Promise<Result<Blob, AppError>>;
}

export type Sha256 = (data: ArrayBuffer) => Promise<string>;

export const webCryptoSha256: Sha256 = async (data) => {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Builds a bundle: `context.md`, its assets and detail files, and a manifest that lists every
 * file with its hash. The manifest is validated against the receiver contract before release.
 */
export class Packager {
  constructor(
    private readonly assets: AssetSource,
    private readonly sha256: Sha256 = webCryptoSha256,
  ) {}

  async build(input: PackageInput): Promise<Result<Bundle, AppError>> {
    const files = new Map<string, Blob>([
      [BUNDLE_ENTRY, new Blob([input.rendered.markdown], { type: 'text/markdown' })],
    ]);
    for (const file of input.rendered.files) {
      if (file.content.kind === 'text') {
        files.set(file.path, new Blob([file.content.text], { type: file.mediaType }));
        continue;
      }
      const blob = await this.assets.get(file.content.asset.id);
      if (!blob.ok) return blob;
      // The asset's declared type is authoritative; stored blobs need not carry one.
      files.set(file.path, new Blob([blob.value], { type: file.mediaType }));
    }

    const listed: BundleFile[] = [];
    for (const [path, blob] of files) {
      listed.push({
        path,
        mediaType: blob.type,
        sha256: await this.sha256(await blob.arrayBuffer()),
        bytes: blob.size,
      });
    }

    const owned = (stepId: string, shapeId: string) =>
      input.rendered.files
        .filter((file) => file.owner?.stepId === stepId && file.owner.shapeId === shapeId)
        .map((file) => file.path);

    const manifest = parseWith(bundleManifestSchema, {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      taskId: input.taskId,
      createdAt: input.createdAt,
      client: { version: input.clientVersion },
      steps: input.steps.map(({ shapeIds, ...step }) => ({
        ...step,
        shapes: shapeIds.map((id) => ({ id, files: owned(step.id, id) })),
      })),
      files: listed,
      entry: BUNDLE_ENTRY,
    });
    if (!manifest.ok) {
      return err(
        appError(
          'internal',
          'Packager produced a manifest that breaks the contract',
          manifest.error.details,
        ),
      );
    }
    const index = [...listed]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join('');
    const digest = await this.sha256(await new Blob([index]).arrayBuffer());
    return ok({ manifest: manifest.value, files, digest });
  }
}
