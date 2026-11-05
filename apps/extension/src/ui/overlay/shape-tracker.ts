import type { ShapeSubject, ViewportSnapshot } from '@redline/capture';
import { appError, err, ok, type AppError, type Logger, type Result } from '@redline/core';
import {
  isRegionLive,
  summarizeRegion,
  type DomQuery,
  type RegionResolver,
  type RegionSummary,
  type ResolvedRegion,
} from '@redline/dom';
import { rectPolygon, type Point, type Polygon } from '@redline/geometry';
import type { CapturedShape } from './capture-machine';

/**
 * Coordinates: a shape keeps the viewport outline it was drawn with and the page scroll at that
 * moment. To place it on the page as it is now, or on a snapshot taken at another scroll, it is
 * moved by the difference between the two scroll offsets.
 */
export const shift = (polygon: Polygon, by: Point): Point[] =>
  polygon.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));

/** How far content seen at scroll `from` appears moved when the page is at scroll `to`. */
export const offsetBetween = (from: Point, to: Point): Point => ({
  x: from.x - to.x,
  y: from.y - to.y,
});

/** What a drawn shape refers to on the page, and the screen it was drawn on. */
interface Resolution {
  readonly region: ResolvedRegion;
  readonly snapshot: ViewportSnapshot | null;
}

export interface ShapeTrackerDeps {
  readonly dom: DomQuery;
  readonly resolver: RegionResolver;
  /** Takes a snapshot of the viewport as the page shows it, without the overlay. */
  readonly takeSnapshot: () => Promise<Result<ViewportSnapshot, AppError>>;
  /** The page's scroll offset now. */
  readonly scroll: () => Point;
  /** The viewport now, to tell whether a snapshot still shows the same view. */
  readonly screen: () => {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  /** Taken before the overlay appeared; reused while the page has not scrolled. */
  readonly initialSnapshot: ViewportSnapshot | null;
  readonly logger: Logger;
}

/**
 * What the drawn shapes refer to: for each, the region of the page it encloses and the snapshot
 * of the screen it was drawn on. The only owner of that knowledge, for a session that draws and
 * a step that collects; the capture machine only knows each shape's outline and status.
 */
export class ShapeTracker {
  private readonly resolutions = new Map<string, Resolution>();
  private snapshot: ViewportSnapshot | null;
  /** Snapshots are taken one at a time: each needs the overlay hidden. */
  private snapshotQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ShapeTrackerDeps) {
    this.snapshot = deps.initialSnapshot;
  }

  /**
   * Pairs a shape with a snapshot of the page as drawn, then resolves what it encloses. Gives
   * the outline it settles on (a click becomes the box of what was clicked), in the shape's own
   * coordinates, and a summary; `null` when it encloses nothing.
   */
  async resolve(
    shape: CapturedShape,
  ): Promise<{ readonly polygon: Polygon; readonly summary: RegionSummary } | null> {
    const snapshot = await this.snapshotAt(shape.scroll);
    const offset = offsetBetween(shape.scroll, this.deps.scroll());
    const polygon = shape.source === 'click' ? this.pickedBox(shape) : shift(shape.polygon, offset);
    const region = polygon === null ? null : this.deps.resolver.resolve(polygon);
    if (polygon === null || region === null) {
      this.resolutions.delete(shape.id);
      return null;
    }
    this.resolutions.set(shape.id, { region, snapshot });
    return {
      polygon: shift(polygon, { x: -offset.x, y: -offset.y }),
      summary: summarizeRegion(region),
    };
  }

  /** The region a shape encloses, for highlighting it. */
  regionOf(shapeId: string): ResolvedRegion | null {
    return this.resolutions.get(shapeId)?.region ?? null;
  }

  /** Forgets shapes that are no longer drawn. */
  keepOnly(shapeIds: Iterable<string>): void {
    const kept = new Set(shapeIds);
    for (const id of this.resolutions.keys()) if (!kept.has(id)) this.resolutions.delete(id);
  }

  /**
   * The shapes as the step collects them: each outline in the coordinates of the snapshot it
   * will be drawn on, and each region as the page is now. If the page re-rendered since a shape
   * was drawn (the circled elements were replaced while the user typed), its outline is
   * resolved again, so context comes from what is on screen rather than detached copies.
   */
  subjects(shapes: readonly CapturedShape[]): Result<ShapeSubject[], AppError> {
    const subjects: ShapeSubject[] = [];
    for (const shape of shapes) {
      const resolution = this.resolutions.get(shape.id);
      if (resolution === undefined) {
        return err(
          appError('internal', 'A shape was sent before it was resolved', { shapeId: shape.id }),
        );
      }
      const { snapshot } = resolution;
      const reference = snapshot?.scroll ?? this.deps.scroll();
      subjects.push({
        id: shape.id,
        source: shape.source,
        polygon: shift(shape.polygon, offsetBetween(shape.scroll, reference)),
        region: this.liveRegion(shape, resolution.region),
        snapshot,
      });
    }
    return ok(subjects);
  }

  private liveRegion(shape: CapturedShape, region: ResolvedRegion): ResolvedRegion {
    if (isRegionLive(region)) return region;
    const now = shift(shape.polygon, offsetBetween(shape.scroll, this.deps.scroll()));
    const again = this.deps.resolver.resolve(now);
    if (again === null) {
      this.deps.logger.warn('The circled elements left the page', { shapeId: shape.id });
      return region;
    }
    return again;
  }

  /** A click picks the topmost element under the pointer; its box becomes the outline. */
  private pickedBox(shape: CapturedShape): Polygon | null {
    const [point] = shift(shape.polygon, offsetBetween(shape.scroll, this.deps.scroll()));
    const element = point === undefined ? null : this.deps.dom.topmostAt(point);
    return element === null ? null : rectPolygon(this.deps.dom.rectOf(element));
  }

  /** Snapshot matching the page at `scroll`: the current one if still valid, else a new one. */
  private snapshotAt(scroll: Point): Promise<ViewportSnapshot | null> {
    const next = this.snapshotQueue.then(async () => {
      const current = this.snapshot;
      if (current !== null && this.showsSameView(current, scroll)) return current;
      const taken = await this.deps.takeSnapshot();
      if (!taken.ok) {
        this.deps.logger.warn('Viewport snapshot failed; the step will have no screenshot', {
          ...taken.error,
        });
        return null;
      }
      this.snapshot = taken.value;
      return taken.value;
    });
    this.snapshotQueue = next;
    return next;
  }

  private showsSameView(snapshot: ViewportSnapshot, scroll: Point): boolean {
    const screen = this.deps.screen();
    return (
      snapshot.scroll.x === scroll.x &&
      snapshot.scroll.y === scroll.y &&
      snapshot.viewport.width === screen.width &&
      snapshot.viewport.height === screen.height &&
      snapshot.devicePixelRatio === screen.devicePixelRatio
    );
  }
}
