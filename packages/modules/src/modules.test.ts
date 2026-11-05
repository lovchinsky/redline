import {
  CaptureEngine,
  CollectionPlanner,
  type ErasedCollector,
  type Profiles,
} from '@redline/capture';
import { FragmentCatalog, FragmentSet, type AnyFragment } from '@redline/core';
import { describe, expect, it } from 'vitest';
import { createAnchorsCollector } from './anchors/collector';
import { collectors } from './collectors';
import { fragmentDescriptors } from './descriptors';
import { FakeImages, captureContext, get, mount, shapeAround, stepOf } from './testing/harness';
import { mountPricing } from './testing/pricing';

const catalog = new FragmentCatalog(fragmentDescriptors);

const only = (ids: string[]): Profiles => ({
  text: { collectors: ids },
  style: { collectors: ids },
  layout: { collectors: ids },
  bug: { collectors: ids },
  'new-element': { collectors: ids },
});

const collect = async (
  id: string,
  shapes: Parameters<typeof stepOf>[2],
  images = new FakeImages(),
  available: readonly ErasedCollector[] = collectors,
) => {
  const planner = new CollectionPlanner(available, only([id]));
  const engine = new CaptureEngine(catalog, [], { defaultTimeoutMs: 2000 }, { now: () => 0 });
  const capture = await engine.run(
    planner.plan('layout'),
    stepOf('layout', 'x', shapes),
    captureContext(images),
  );
  return FragmentSet.fromCapture(capture);
};

const first = <T extends AnyFragment>(fragments: T[]): T => {
  const [fragment] = fragments;
  if (fragment === undefined) throw new Error('Expected a fragment');
  return fragment;
};

describe('anchors', () => {
  it('ranks hand-written identifiers first and drops generated and utility classes', async () => {
    mountPricing();
    const set = await collect('anchors', [shapeAround('s1', [get('.title')])]);
    const anchors = first(set.ofKind('anchors')).data.anchors.map((a) => `${a.kind}:${a.value}`);

    expect(anchors[0]).toBe('text:Choose your plan');
    expect(anchors).toContain('class:title');
    expect(anchors.some((a) => a.includes('css-1x2y3z'))).toBe(false);
  });

  it('uses custom element tags and link targets', async () => {
    mountPricing();
    const set = await collect('anchors', [shapeAround('s1', [get('.enterprise')])]);
    const anchors = first(set.ofKind('anchors')).data.anchors.map((a) => `${a.kind}:${a.value}`);
    expect(anchors).toEqual(
      expect.arrayContaining(['custom-tag:pricing-contact', 'href:/contact', 'text:Talk to sales']),
    );
  });

  it('penalizes stock wording below a unique phrase', async () => {
    mount(
      '<div class="dialog"><p class="question">Delete the Acme workspace?</p><button>OK</button></div>',
      '.dialog { width: 400px; padding: 20px; }',
    );
    const set = await collect('anchors', [shapeAround('s1', [get('.dialog')])]);
    const values = first(set.ofKind('anchors')).data.anchors.map((a) => a.value);
    expect(values.indexOf('Delete the Acme workspace?')).toBeLessThan(values.indexOf('dialog'));
    expect(values).not.toContain('OK');
  });

  it('accepts new sources and rules without changing the collector', async () => {
    mountPricing();
    const roleSource = {
      id: 'role',
      extract: (element: Element) =>
        element.localName === 'button'
          ? [
              {
                kind: 'text' as const,
                value: 'button:role',
                attribute: null,
                raw: 'button:role',
                element,
              },
            ]
          : [],
    };
    const preferRole = {
      id: 'prefer-role',
      evaluate: (c: { value: string }) => (c.value === 'button:role' ? 500 : 0),
    };
    const custom = createAnchorsCollector([roleSource], [preferRole]);
    const set = await collect(
      'anchors',
      [shapeAround('s1', [get('.card button')])],
      new FakeImages(),
      [custom],
    );
    expect(first(set.ofKind('anchors')).data.anchors.map((a) => a.value)).toEqual(['button:role']);
  });
});

describe('layout', () => {
  it('describes the container and marks circled children', async () => {
    mountPricing();
    const cards = Array.from(document.querySelectorAll('[data-testid="plan-card"]')).slice(0, 2);
    const { data } = first((await collect('layout', [shapeAround('s1', cards)])).ofKind('layout'));

    expect(data.styles).toEqual({ display: 'flex', 'align-items': 'flex-start', gap: '24px' });
    expect(data.children.map((c) => c.circled)).toEqual([true, true, false, false]);
    expect(data.children[1]?.box).toEqual({ x: 244, y: 0, width: 220, height: 200 });
  });
});

describe('screenshot', () => {
  it('crops around the lasso with padding and adds a viewport overview', async () => {
    mountPricing();
    const images = new FakeImages();
    const shape = shapeAround('s1', [get('.badge')]);
    const set = await collect('screenshot', [shape], images);

    const [crop, overview] = images.requests;
    expect(crop?.format).toBe('image/png');
    expect(crop?.outline).toBe(shape.polygon);
    expect(crop?.area.width).toBeGreaterThan(48 + 24);
    expect(overview).toMatchObject({
      format: 'image/webp',
      area: { x: 0, y: 0, width: 1280, height: 800 },
    });
    const fragment = first(set.ofKind('screenshot'));
    expect(fragment.data.images.map((i) => i.role)).toEqual(['crop', 'overview']);
    expect(fragment.assets.map((a) => a.id)).toEqual(['image-1', 'image-2']);
  });

  it('fails the collector, not the step, when an image cannot be derived', async () => {
    mountPricing();
    const failing = {
      derive: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: 'storage' as const, message: 'disk full' },
        }),
    };
    const set = await collect(
      'screenshot',
      [shapeAround('s1', [get('.badge')])],
      failing as unknown as FakeImages,
    );
    expect(set.fragments).toEqual([]);
    expect(set.diagnostics).toEqual([
      expect.objectContaining({
        source: 'screenshot',
        outcome: 'failed',
        message: expect.stringContaining('disk full') as string,
      }),
    ]);
  });
});

describe('page-meta', () => {
  it('reports the route pattern and the serving environment', async () => {
    mountPricing();
    const { data } = first(
      (await collect('page-meta', [shapeAround('s1', [get('.badge')])])).ofKind('page-meta'),
    );
    expect(data).toMatchObject({
      routePattern: '/pricing',
      environment: 'dev-server',
      devicePixelRatio: 2,
    });
  });
});

describe('dom-snapshot', () => {
  it('serializes the container and marks circled elements', async () => {
    mountPricing();
    const set = await collect('dom-snapshot', [shapeAround('s1', [get('.badge')])]);
    const { data } = first(set.ofKind('dom-snapshot'));
    expect(data.root).toBe('article[data-testid=plan-card]');
    expect(data.html).toContain('<span class="badge" data-redline="selected">Most popular</span>');
  });
});
