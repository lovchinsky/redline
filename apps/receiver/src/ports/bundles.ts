import type { BlobDigest } from '../domain/ids';

/** A file being written to the blob store, hashed as it arrives. */
export interface BlobWriter {
  write(chunk: Uint8Array): Promise<void>;
  /** Stores the file under its SHA-256 and returns it. Writing the same bytes again is free. */
  commit(): Promise<{ readonly digest: BlobDigest; readonly bytes: number }>;
  /** Drops what was written. */
  discard(): Promise<void>;
}

/** Files by their SHA-256: bundles, snapshots, changes, artifacts. */
export interface BlobStore {
  writer(): BlobWriter;
  read(digest: BlobDigest): Promise<Uint8Array | null>;
  has(digest: BlobDigest): Promise<boolean>;
}

export interface BundleStep {
  readonly id: string;
  readonly url: string;
  readonly comment: string;
  readonly viewport: { readonly width: number; readonly height: number };
}

export interface BundleFile {
  readonly path: string;
  readonly digest: BlobDigest;
  readonly mediaType: string;
}

/** What the receiver reads from a stored bundle: its steps and where its files are. */
export interface BundleContents {
  readonly steps: readonly BundleStep[];
  readonly files: readonly BundleFile[];
  readonly entry: string;
}

export interface BundleReader {
  read(manifest: BlobDigest): Promise<BundleContents | null>;
}
