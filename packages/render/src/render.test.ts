import {
  FragmentCatalog,
  type AssetId,
  type ErasedFragmentDescriptor,
  type FragmentBase,
} from '@redline/core';
import { bundleManifestSchema } from '@redline/contract';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { Packager } from './packager';
import { MarkdownContextRenderer, type RenderInput } from './renderer';

const pageFragment: ErasedFragmentDescriptor = {
  kind: 'test-page',
  version: 1,
  schema: z.object({ route: z.string() }),
  migrations: [],
  presenter: {
    summarize: (f) => [
      { section: 'page', markdown: `**Page:** ${(f.data as { route: string }).route}` },
    ],
  },
};

const areaFragment: ErasedFragmentDescriptor = {
  kind: 'test-area',
  version: 1,
  schema: z.object({ label: z.string() }),
  migrations: [],
  presenter: {
    summarize: (f, context) => {
      const [image] = f.assets;
      const label = (f.data as { label: string }).label;
      const dom = {
        name: 'dom',
        extension: 'html' as const,
        mediaType: 'text/html',
        content: `<p>${label}</p>`,
      };
      return [
        // Deliberately out of order: the renderer sorts sections.
        { section: 'details', markdown: `[DOM](${context.detailPath(dom)})` },
        { section: 'region', markdown: `**Circled:** ${label}` },
        ...(image === undefined
          ? []
          : [
              {
                section: 'images' as const,
                markdown: `![crop](${context.assetPath(image, 'crop')})`,
              },
            ]),
      ];
    },
    details: (f) => [
      {
        name: 'dom',
        extension: 'html',
        mediaType: 'text/html',
        content: `<p>${(f.data as { label: string }).label}</p>`,
      },
    ],
  },
};

const catalog = new FragmentCatalog([pageFragment, areaFragment]);
const png = (id: string) => ({ id: id as AssetId, mediaType: 'image/png', bytes: 3 });

const fragment = (overrides: Partial<FragmentBase>): FragmentBase => ({
  kind: 'test-area',
  version: 1,
  target: { level: 'step' },
  priority: 'normal',
  data: {},
  assets: [],
  ...overrides,
});

const input: RenderInput = {
  steps: [
    {
      id: 'step-a',
      intent: 'layout',
      comment: 'Cards must have equal height\nand the badge goes right',
      shapeIds: ['s1', 's2'],
      fragments: [
        fragment({ kind: 'test-page', data: { route: '/pricing' } }),
        fragment({
          target: { level: 'shape', shapeId: 's1' },
          data: { label: 'cards ×3' },
          assets: [png('a1')],
        }),
        fragment({
          target: { level: 'shape', shapeId: 's2' },
          data: { label: 'badge' },
          assets: [png('a2')],
        }),
      ],
    },
    {
      id: 'step-b',
      intent: 'text',
      comment: 'Fix the typo',
      shapeIds: ['s3'],
      fragments: [
        fragment({ target: { level: 'shape', shapeId: 's3' }, data: { label: 'title' } }),
      ],
    },
  ],
};

describe('MarkdownContextRenderer', () => {
  it('renders steps, areas and sections in a fixed order (golden)', async () => {
    const rendered = new MarkdownContextRenderer(catalog).render(input);
    await expect(rendered.markdown).toMatchFileSnapshot('./__golden__/two-steps.md');
    expect(rendered.warnings).toEqual([]);
  });

  it('assigns readable paths to assets and detail files, owned by their area', () => {
    const { files } = new MarkdownContextRenderer(catalog).render(input);
    expect(files.map((f) => [f.path, f.owner.shapeId])).toEqual([
      ['details/step-1/area-1-dom.html', 's1'],
      ['assets/step-1/area-1-crop.png', 's1'],
      ['details/step-1/area-2-dom.html', 's2'],
      ['assets/step-1/area-2-crop.png', 's2'],
      ['details/step-2/area-1-dom.html', 's3'],
    ]);
  });

  it('reports fragments it cannot present', () => {
    const rendered = new MarkdownContextRenderer(new FragmentCatalog([])).render(input);
    expect(rendered.warnings).toContain('No presenter for fragment kind "test-area"');
  });
});

describe('Packager', () => {
  const rendered = new MarkdownContextRenderer(catalog).render(input);
  const steps = input.steps.map((step) => ({
    id: step.id,
    url: 'https://acme.io/pricing',
    routePattern: '/pricing',
    intent: step.intent,
    comment: step.comment,
    viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    shapeIds: step.shapeIds,
  }));
  const base = {
    taskId: 'task-1',
    projectId: 'acme-web',
    createdAt: '2026-11-05T10:00:00Z',
    clientVersion: '0.1.0',
    steps,
    rendered,
  };

  it('produces a contract-valid manifest listing every file with its hash', async () => {
    const packager = new Packager({
      get: () => Promise.resolve({ ok: true, value: new Blob(['png'], { type: 'image/png' }) }),
    });

    const bundle = await packager.build(base);

    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const { manifest, files } = bundle.value;
    expect(bundleManifestSchema.safeParse(manifest).success).toBe(true);
    expect([...files.keys()]).toEqual(['context.md', ...rendered.files.map((f) => f.path)]);
    expect(manifest.steps[0]?.shapes).toEqual([
      { id: 's1', files: ['details/step-1/area-1-dom.html', 'assets/step-1/area-1-crop.png'] },
      { id: 's2', files: ['details/step-1/area-2-dom.html', 'assets/step-1/area-2-crop.png'] },
    ]);
    const crop = manifest.files.find((f) => f.path === 'assets/step-1/area-1-crop.png');
    // printf 'png' | sha256sum
    expect(crop?.sha256).toBe('8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c');
  });

  it('fails when an asset cannot be read', async () => {
    const packager = new Packager({
      get: () => Promise.resolve({ ok: false, error: { code: 'not-found', message: 'gone' } }),
    });
    const bundle = await packager.build(base);
    expect(bundle.ok ? null : bundle.error.code).toBe('not-found');
  });
});
