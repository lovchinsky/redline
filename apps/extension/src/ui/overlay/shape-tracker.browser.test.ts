import type { ViewportSnapshot } from '@redline/capture';
import { AssetId, appError, err, ok, type Logger } from '@redline/core';
import type { DomQuery, RegionResolver, ResolvedRegion } from '@redline/dom';
import { rectPolygon, type Point, type Polygon, type Rect } from '@redline/geometry';
import { afterEach, describe, expect, it } from 'vitest';
import type { CapturedShape } from './capture-machine';
import { ShapeTracker } from './shape-tracker';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const screen = { width: 1280, height: 800, devicePixelRatio: 1 };

const snapshotAt = (scroll: Point, id = 'snap'): ViewportSnapshot => ({
  asset: { id: AssetId.parse(id), mediaType: 'image/png', bytes: 1 },
  scroll,
  viewport: { width: screen.width, height: screen.height },
  devicePixelRatio: screen.devicePixelRatio,
  sensitiveRects: [],
});

const square: Polygon = rectPolygon({ x: 10, y: 10, width: 50, height: 50 });

const shapeOf = (overrides: Partial<CapturedShape> = {}): CapturedShape => ({
  id: 'shape-1',
  source: 'lasso',
  polygon: square,
  scroll: { x: 0, y: 0 },
  ...overrides,
});

/** A card on the page, as the resolver would find it. */
const card = (): Element => {
  const element = document.createElement('div');
  element.className = 'plan-card';
  document.body.append(element);
  return element;
};

const regionOf = (element: Element, polygon: Polygon): ResolvedRegion => ({
  kind: 'elements',
  polygon,
  groups: [{ signature: 'div.plan-card', elements: [element] }],
  container: document.body,
  neighbors: [],
});

/** The page as the tracker sees it: its scroll, its elements, and the snapshots it takes. */
const page = (initialSnapshot: ViewportSnapshot | null = null) => {
  const state = {
    scroll: { x: 0, y: 0 },
    element: card(),
    snapshots: 0,
    failSnapshot: false,
    asked: [] as Polygon[],
  };
  const resolver: RegionResolver = {
    resolve: (polygon) => {
      state.asked.push(polygon);
      return regionOf(state.element, polygon);
    },
  };
  const box: Rect = { x: 100, y: 200, width: 30, height: 40 };
  const dom: DomQuery = {
    topmostAt: () => state.element,
    rectOf: () => box,
    isVisible: () => true,
    parentOf: () => null,
    childrenOf: () => [],
    hasOwnTextAt: () => false,
  };
  const tracker = new ShapeTracker({
    dom,
    resolver,
    takeSnapshot: () => {
      state.snapshots += 1;
      return Promise.resolve(
        state.failSnapshot
          ? err(appError('internal', 'capture refused'))
          : ok(snapshotAt(state.scroll, `snap-${String(state.snapshots)}`)),
      );
    },
    scroll: () => state.scroll,
    screen: () => screen,
    initialSnapshot,
    logger: silent,
  });
  return { state, tracker, box };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('ShapeTracker', () => {
  it('reuses the snapshot taken before the overlay while the page has not scrolled', async () => {
    const { state, tracker } = page(snapshotAt({ x: 0, y: 0 }, 'initial'));
    const resolved = await tracker.resolve(shapeOf());
    expect(resolved?.polygon).toEqual(square);
    expect(resolved?.summary.groups).toEqual([{ label: 'div.plan-card', count: 1 }]);
    expect(state.snapshots).toBe(0);

    expect(tracker.subjects([shapeOf()])).toMatchObject({
      ok: true,
      value: [{ snapshot: { asset: { id: 'initial' } }, polygon: square }],
    });
  });

  it('takes a new snapshot for a shape drawn after scrolling, and keeps it in that one’s terms', async () => {
    const { state, tracker } = page(snapshotAt({ x: 0, y: 0 }, 'initial'));
    state.scroll = { x: 0, y: 300 };
    const shape = shapeOf({ scroll: { x: 0, y: 300 } });
    expect((await tracker.resolve(shape))?.polygon).toEqual(square);
    expect(state.snapshots).toBe(1);
    // The page is where the shape was drawn: the resolver gets the outline unmoved.
    expect(state.asked).toEqual([square]);

    // Scrolled again before sending: the outline stays in the coordinates of its snapshot.
    state.scroll = { x: 0, y: 500 };
    const subjects = tracker.subjects([shape]);
    expect(subjects).toMatchObject({
      ok: true,
      value: [{ snapshot: { asset: { id: 'snap-1' }, scroll: { y: 300 } }, polygon: square }],
    });
  });

  it('places a shape on the page as it is now when the page scrolled since it was drawn', async () => {
    const { state, tracker } = page();
    const shape = shapeOf();
    state.scroll = { x: 0, y: 40 };
    await tracker.resolve(shape);
    // Content drawn at scroll 0 now sits 40px higher on screen.
    expect(state.asked).toEqual([square.map((p) => ({ x: p.x, y: p.y - 40 }))]);
  });

  it('turns a click into the box of the element under it, in the shape’s own coordinates', async () => {
    const { state, tracker, box } = page();
    const click = shapeOf({ source: 'click', polygon: [{ x: 110, y: 210 }] });
    state.scroll = { x: 0, y: 20 };
    const resolved = await tracker.resolve(click);
    expect(state.asked).toEqual([rectPolygon(box)]);
    expect(resolved?.polygon).toEqual(rectPolygon({ ...box, y: box.y + 20 }));
  });

  it('resolves again when the circled elements were replaced before sending', async () => {
    const { state, tracker } = page();
    const shape = shapeOf();
    await tracker.resolve(shape);
    const replaced = state.element;
    replaced.remove();
    state.element = card();

    const subjects = tracker.subjects([shape]);
    expect(subjects.ok && subjects.value[0]?.region.groups[0]?.elements).toEqual([state.element]);
  });

  it('sends a shape without a screenshot when the snapshot fails, and refuses an unresolved one', async () => {
    const { state, tracker } = page();
    state.failSnapshot = true;
    await tracker.resolve(shapeOf());
    expect(tracker.subjects([shapeOf()])).toMatchObject({ ok: true, value: [{ snapshot: null }] });
    expect(tracker.subjects([shapeOf({ id: 'never-resolved' })])).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });

  it('forgets shapes that are no longer drawn', async () => {
    const { tracker } = page();
    await tracker.resolve(shapeOf());
    expect(tracker.regionOf('shape-1')).not.toBeNull();
    tracker.keepOnly([]);
    expect(tracker.regionOf('shape-1')).toBeNull();
  });
});
