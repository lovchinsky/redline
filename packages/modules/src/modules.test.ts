import { CaptureEngine, buildCollectionPlan, type ErasedCollector } from '@redline/capture';
import { FragmentCatalog, FragmentSet, type AnyFragment } from '@redline/core';
import { describe, expect, it } from 'vitest';
import { createAnchorsCollector } from './anchors/collector';
import { collectors } from './collectors';
import { fragmentDescriptors } from './descriptors';
import { FakeImages, captureContext, get, mount, shapeAround, stepOf } from './testing/harness';
import { mountPricing } from './testing/pricing';
import { screenshotFragment } from './screenshot/descriptor';

const catalog = new FragmentCatalog(fragmentDescriptors);

const collect = async (
  id: string,
  shapes: Parameters<typeof stepOf>[1],
  images = new FakeImages(),
  available: readonly ErasedCollector[] = collectors,
) => {
  const plan = buildCollectionPlan(available, { collectors: [id] });
  const engine = new CaptureEngine(catalog, [], { defaultTimeoutMs: 2000 }, { now: () => 0 });
  const capture = await engine.run(plan, stepOf('x', shapes), captureContext(images));
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
    expect(screenshotFragment.presenter.thumbnail?.(fragment)?.id).toBe('image-1');
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

describe('computed-styles', () => {
  it('reports what styles the circled element, not initial or inherited values', async () => {
    mountPricing();
    const set = await collect('computed-styles', [shapeAround('s1', [get('.badge')])]);
    const [element] = first(set.ofKind('computed-styles')).data.elements;
    expect(element?.label).toBe('span.badge');
    expect(element?.styles).toMatchObject({ display: 'block', height: '20px' });
    // Same font and colour as the card around it: inherited, so not reported.
    expect(element?.styles).not.toHaveProperty('font-family');
    expect(element?.styles).not.toHaveProperty('color');
    expect(element?.styles).not.toHaveProperty('position');
  });

  it('looks at one element per group of identical siblings', async () => {
    mountPricing();
    const cards = Array.from(document.querySelectorAll('[data-testid="plan-card"]'));
    const set = await collect('computed-styles', [shapeAround('s1', cards)]);
    const { elements } = first(set.ofKind('computed-styles')).data;
    expect(elements.map((e) => e.label)).toEqual(['article[data-testid=plan-card]']);
    expect(elements[0]?.styles).toMatchObject({ padding: '16px', width: '220px' });
  });
});

describe('css-rules', () => {
  const addStyle = (css: string, devId?: string) => {
    const style = document.createElement('style');
    if (devId !== undefined) style.dataset['viteDevId'] = devId;
    style.textContent = css;
    document.head.append(style);
    return style;
  };

  it('lists matching rules with their source file, conditions and inline styles', async () => {
    mountPricing();
    const styles = [
      addStyle(
        `* { box-sizing: border-box; }
         .badge { color: crimson; font-weight: 600; }
         @media (min-width: 1px) { .card .badge { letter-spacing: 0.02em; } }
         @media (max-width: 1px) { .badge { color: blue; } }`,
        '/Users/maria/work/acme/src/components/Badge.css',
      ),
    ];
    get('.badge').setAttribute('style', 'margin-top: 4px');
    const set = await collect('css-rules', [shapeAround('s1', [get('.badge')])]);
    const data = first(set.ofKind('css-rules')).data;
    const rules = data.elements[0]?.rules ?? [];

    expect(rules.map((rule) => rule.selector)).toEqual([
      '.badge',
      '.badge',
      '.card .badge',
      'style=""',
    ]);
    expect(rules[1]).toEqual({
      selector: '.badge',
      declarations: 'color: crimson; font-weight: 600;',
      source: { kind: 'dev-module', path: 'src/components/Badge.css' },
      conditions: [],
    });
    expect(rules[2]?.conditions).toEqual(['@media (min-width: 1px)']);
    expect(rules[0]?.source).toEqual({ kind: 'inline-style-element' });
    expect(data.unreadableSheets).toBe(0);
    for (const style of styles) style.remove();
  });

  it('reads constructed stylesheets of the shadow root an element lives in', async () => {
    mount('<x-card></x-card>', '');
    const host = get('x-card');
    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.inner { display: block; width: 200px; height: 100px; }');
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = '<div class="inner">Inside</div>';
    const inner = root.querySelector('.inner');
    if (inner === null) throw new Error('fixture');
    const set = await collect('css-rules', [shapeAround('s1', [inner])]);
    const rules = first(set.ofKind('css-rules')).data.elements[0]?.rules ?? [];
    expect(rules).toMatchObject([{ selector: '.inner', source: { kind: 'constructed' } }]);
  });
});
