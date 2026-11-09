import { createHash } from 'node:crypto';
import { BUNDLE_ENTRY, MANIFEST_PART, PROJECT_PART, type BundleManifest } from '@redline/contract';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface BundleFiles {
  readonly [path: string]: Uint8Array<ArrayBuffer>;
}

/** A small, valid `bundle.v1` bundle: one step, one area, `context.md` and a screenshot. */
export const sampleFiles = (): BundleFiles => ({
  [BUNDLE_ENTRY]: new TextEncoder().encode(
    '# Redline task\n\n## Step 1\n\n> Rename "Most popular" to "Best value"\n',
  ),
  'assets/step-1/area-1-crop.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
});

export const manifestFor = (files: BundleFiles, taskId = 'conformance-draft'): BundleManifest => ({
  schemaVersion: 1,
  taskId,
  createdAt: '2026-11-09T10:00:00.000Z',
  client: { version: 'conformance' },
  steps: [
    {
      id: 'step-1',
      url: 'https://staging.acme.io/pricing',
      routePattern: '/pricing',
      comment: 'Rename "Most popular" to "Best value"',
      viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      shapes: [
        { id: 'shape-1', files: Object.keys(files).filter((path) => path !== BUNDLE_ENTRY) },
      ],
    },
  ],
  files: Object.entries(files).map(([path, bytes]) => ({
    path,
    mediaType: path.endsWith('.png') ? 'image/png' : 'text/markdown',
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  })),
  entry: BUNDLE_ENTRY,
});

/** The multipart body of `POST /v1/tasks`, as the extension sends it. */
export const submissionForm = (
  projectId: string,
  files: BundleFiles = sampleFiles(),
  manifest: unknown = manifestFor(files),
): FormData => {
  const form = new FormData();
  form.append(
    MANIFEST_PART,
    new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    'manifest.json',
  );
  form.append(PROJECT_PART, projectId);
  for (const [path, bytes] of Object.entries(files)) form.append(path, new Blob([bytes]), path);
  return form;
};
