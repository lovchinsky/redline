import { describe, expect, it } from 'vitest';
import { bundleManifestSchema, bundlePathSchema, type BundleManifest } from './bundle.v1';

const sha = 'a'.repeat(64);

const validManifest = (): BundleManifest => ({
  schemaVersion: 1,
  taskId: 'task-1',
  projectId: 'acme-web',
  createdAt: '2026-11-04T10:00:00Z',
  client: { version: '0.1.0' },
  steps: [
    {
      id: 'step-1',
      url: 'https://staging.acme.io/pricing',
      routePattern: '/pricing',
      intent: 'layout',
      comment: 'Cards must have equal height',
      viewport: { width: 1440, height: 900, devicePixelRatio: 2, scrollX: 0, scrollY: 120 },
      shapes: [{ id: 'shape-1', files: ['step1_crop.png'] }],
    },
  ],
  files: [
    { path: 'context.md', mediaType: 'text/markdown', sha256: sha, bytes: 1200 },
    { path: 'step1_crop.png', mediaType: 'image/png', sha256: sha, bytes: 48000 },
  ],
  entry: 'context.md',
});

describe('bundle.v1 manifest', () => {
  it('accepts a consistent manifest', () => {
    expect(bundleManifestSchema.safeParse(validManifest()).success).toBe(true);
  });

  it('rejects a shape file that is not listed in files', () => {
    const manifest = validManifest();
    manifest.files = manifest.files.filter((f) => f.path !== 'step1_crop.png');
    expect(bundleManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects a missing entry file', () => {
    const manifest = validManifest();
    manifest.files = manifest.files.filter((f) => f.path !== 'context.md');
    expect(bundleManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects duplicate file paths', () => {
    const manifest = validManifest();
    const first = manifest.files[0];
    if (first === undefined) throw new Error('fixture must have files');
    manifest.files.push(first);
    expect(bundleManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it('rejects unknown schema versions and steps without shapes', () => {
    expect(bundleManifestSchema.safeParse({ ...validManifest(), schemaVersion: 2 }).success).toBe(
      false,
    );
    const manifest = validManifest();
    const step = manifest.steps[0];
    if (step === undefined) throw new Error('fixture must have a step');
    step.shapes = [];
    expect(bundleManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe('bundle paths', () => {
  it.each(['context.md', 'details/step1_dom.html', 'step-1/crop.png'])('accepts %s', (path) => {
    expect(bundlePathSchema.safeParse(path).success).toBe(true);
  });

  it.each(['/etc/passwd', '../secret', 'details/../../x', 'a/..', 'with space.png', ''])(
    'rejects %s',
    (path) => {
      expect(bundlePathSchema.safeParse(path).success).toBe(false);
    },
  );
});
