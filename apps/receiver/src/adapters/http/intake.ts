import type { Multipart } from '@fastify/multipart';
import { MANIFEST_PART, PROJECT_PART, bundleManifestSchema } from '@redline/contract';
import type { BlobDigest } from '../../domain/ids';
import type { BlobStore } from '../../ports/bundles';

export interface IntakeLimits {
  readonly bundleBytes: number;
  readonly files: number;
}

export type Received =
  | { readonly ok: true; readonly manifest: BlobDigest; readonly projectId: string }
  | {
      readonly ok: false;
      readonly status: 413 | 422;
      readonly code: 'too-large' | 'invalid-bundle';
      readonly message: string;
    };

const invalid = (message: string): Received => ({
  ok: false,
  status: 422,
  code: 'invalid-bundle',
  message,
});
const tooLarge = (message: string): Received => ({
  ok: false,
  status: 413,
  code: 'too-large',
  message,
});

interface Stored {
  readonly digest: BlobDigest;
  readonly bytes: number;
}

/**
 * Reads a submission (`receiver-api.v1`, multipart) whatever the order of its parts: every file
 * goes to the blob store as it arrives, hashed on the way, and the bundle is checked against
 * its manifest once all parts are in. Files of a refused bundle stay unreferenced in the store
 * for garbage collection; a bundle is accepted only whole.
 *
 * The body is read to its end even when the bundle is refused early (up to twice the limit),
 * so the client receives the refusal instead of a broken connection it would retry.
 */
export const receiveBundle = async (
  parts: AsyncIterable<Multipart>,
  blobs: BlobStore,
  limits: IntakeLimits,
): Promise<Received> => {
  const files = new Map<string, Stored>();
  let manifest: Stored | null = null;
  let projectId: string | null = null;
  let total = 0;
  let refusal: Received | null = null;

  for await (const part of parts) {
    if (part.type === 'field') {
      if (part.fieldname === PROJECT_PART && typeof part.value === 'string') projectId = part.value;
      else refusal ??= invalid(`Unexpected field ${part.fieldname}`);
      continue;
    }
    if (refusal !== null) {
      total = await drain(part.file, total, limits.bundleBytes * 2);
      continue;
    }
    const writer = blobs.writer();
    try {
      // The part is always read to its end; past the limit it is only counted.
      for await (const chunk of part.file as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > limits.bundleBytes * 2) throw farTooLarge();
        if (total <= limits.bundleBytes) await writer.write(chunk);
      }
    } catch (error) {
      await writer.discard();
      throw error;
    }
    if (total > limits.bundleBytes) {
      await writer.discard();
      refusal = tooLarge(`The bundle is larger than ${String(limits.bundleBytes)} bytes`);
      continue;
    }
    const stored = await writer.commit();
    if (part.fieldname === MANIFEST_PART) manifest = stored;
    else if (files.has(part.fieldname)) refusal = invalid(`File ${part.fieldname} was sent twice`);
    else files.set(part.fieldname, stored);
    if (files.size > limits.files)
      refusal ??= tooLarge(`The bundle has more than ${String(limits.files)} files`);
  }

  if (refusal !== null) return refusal;
  if (manifest === null) return invalid('The manifest part is missing');
  if (projectId === null || projectId === '') return invalid('The projectId part is missing');
  return verify(manifest, files, projectId, blobs);
};

const verify = async (
  manifest: Stored,
  files: ReadonlyMap<string, Stored>,
  projectId: string,
  blobs: BlobStore,
): Promise<Received> => {
  const bytes = await blobs.read(manifest.digest);
  if (bytes === null) throw new Error('A stored manifest is missing');
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid('The manifest is not JSON');
  }
  const parsed = bundleManifestSchema.safeParse(document);
  if (!parsed.success) return invalid(`The manifest is invalid: ${parsed.error.message}`);

  const listed = new Set<string>();
  for (const file of parsed.data.files) {
    if (file.path === MANIFEST_PART || file.path === PROJECT_PART) {
      return invalid(`A bundle file may not be named ${file.path}`);
    }
    listed.add(file.path);
    const received = files.get(file.path);
    if (received === undefined) return invalid(`File ${file.path} is missing`);
    if (received.digest !== file.sha256 || received.bytes !== file.bytes) {
      return invalid(`File ${file.path} does not match its hash`);
    }
  }
  const extra = [...files.keys()].filter((path) => !listed.has(path));
  if (extra.length > 0) return invalid(`Parts not in the manifest: ${extra.join(', ')}`);
  return { ok: true, manifest: manifest.digest, projectId };
};

/** Past twice the limit the body is not read on: the connection is closed with a 413. */
const farTooLarge = () =>
  Object.assign(new Error('The request body is far too large'), { statusCode: 413 });

/** Reads and drops a part, counting it into `total`; returns the new total. */
const drain = async (
  stream: AsyncIterable<unknown>,
  total: number,
  ceiling: number,
): Promise<number> => {
  let counted = total;
  for await (const chunk of stream) {
    counted += (chunk as Uint8Array).byteLength;
    if (counted > ceiling) throw farTooLarge();
  }
  return counted;
};
