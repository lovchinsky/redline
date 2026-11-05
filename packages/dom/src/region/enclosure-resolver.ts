import {
  boundsOf,
  coverage,
  DEFAULT_POLYGON_SAMPLING,
  rectArea,
  rectDistance,
  samplePolygon,
  type Point,
  type Polygon,
  type PolygonSamplingOptions,
  type Rect,
} from '@redline/geometry';
import { structuralSignature } from '../describe';
import type { DomQuery } from '../dom-query';
import { compareTreeOrder, isAncestorOf, lowestCommonAncestor } from '../tree';
import type { ElementGroup, RegionResolver, ResolvedRegion } from './types';

export interface EnclosureOptions {
  /** Minimum share of an element inside the lasso to count as circled (round lassos clip corners). */
  readonly wholeThreshold: number;
  /** A significant child below this share is "left outside" and prevents selecting its parent. */
  readonly outsideThreshold: number;
  /** A child is significant when its area is at least this share of its parent's. */
  readonly significantChildShare: number;
  /** Elements within this distance (CSS px) of the lasso count as neighbors. */
  readonly neighborDistance: number;
  readonly maxNeighbors: number;
  readonly sampling: PolygonSamplingOptions;
}

export const DEFAULT_ENCLOSURE_OPTIONS: EnclosureOptions = {
  wholeThreshold: 0.7,
  outsideThreshold: 0.3,
  significantChildShare: 0.05,
  neighborDistance: 48,
  maxNeighbors: 4,
  sampling: DEFAULT_POLYGON_SAMPLING,
};

const isNonEmpty = <T>(items: T[]): items is [T, ...T[]] => items.length > 0;

/** Never selected as a circled element: they stand for the page, not something on it. */
const PAGE_ROOTS = new Set(['html', 'body']);

/**
 * Resolves a lasso to the maximal elements it wholly encloses.
 *
 * 1. Sample points inside the lasso and hit-test the topmost element at each one.
 *    Only those elements and their ancestors are candidates, so content hidden under
 *    overlays or modals is never picked.
 * 2. Walk down from their lowest common ancestor. An element is selected as a whole when
 *    enough of it is inside the lasso and none of its significant children is left outside;
 *    otherwise the walk continues into its candidate children.
 * 3. Without a selection, the region is inside a single element: `within-element` when it
 *    cuts through that element's content, `empty-space` when it covers only background.
 */
export class EnclosureResolver implements RegionResolver {
  constructor(
    private readonly dom: DomQuery,
    private readonly options: EnclosureOptions = DEFAULT_ENCLOSURE_OPTIONS,
  ) {}

  resolve(polygon: Polygon): ResolvedRegion | null {
    const bounds = boundsOf(polygon);
    const samples = samplePolygon(polygon, this.options.sampling);
    if (bounds === null || samples.length === 0) return null;

    const hits = this.hitTest(samples);
    const hitElements = [...hits.keys()];
    if (!isNonEmpty(hitElements)) return null;
    const root = lowestCommonAncestor(this.dom, hitElements);

    const scope = new RegionScope(
      this.dom,
      polygon,
      bounds,
      this.candidatesFrom(hits),
      this.options,
    );
    const selected = scope.selectWithin(root).sort((a, b) => compareTreeOrder(this.dom, a, b));

    if (isNonEmpty(selected)) {
      const container = this.containerOf(selected);
      return {
        kind: 'elements',
        polygon,
        groups: this.groupBySignature(selected),
        container,
        neighbors: scope.neighborsIn(container, selected),
      };
    }

    const coversOwnContent =
      hitElements.some((element) => element !== root) || this.dom.hasOwnTextAt(root, samples);
    return {
      kind: coversOwnContent ? 'within-element' : 'empty-space',
      polygon,
      groups: [],
      container: root,
      neighbors: scope.neighborsIn(root, []),
    };
  }

  /** Topmost element at each sample point, with how many samples hit it. */
  private hitTest(samples: readonly Point[]): Map<Element, number> {
    const hits = new Map<Element, number>();
    for (const point of samples) {
      const element = this.dom.topmostAt(point);
      if (element !== null) hits.set(element, (hits.get(element) ?? 0) + 1);
    }
    return hits;
  }

  /** Hit elements plus their ancestors: everything that is visibly painted inside the lasso. */
  private candidatesFrom(hits: Map<Element, number>): Set<Element> {
    const candidates = new Set<Element>();
    for (const hit of hits.keys()) {
      for (
        let current: Element | null = hit;
        current !== null;
        current = this.dom.parentOf(current)
      ) {
        if (candidates.has(current)) break;
        candidates.add(current);
      }
    }
    return candidates;
  }

  /** A single element's container is its parent, so layout around it is described too. */
  private containerOf(selected: readonly [Element, ...Element[]]): Element {
    const [first] = selected;
    if (selected.length === 1) return this.dom.parentOf(first) ?? first;
    return lowestCommonAncestor(this.dom, selected);
  }

  private groupBySignature(selected: readonly Element[]): ElementGroup[] {
    const groups = new Map<string, Element[]>();
    for (const element of selected) {
      const signature = structuralSignature(this.dom, element);
      const group = groups.get(signature);
      if (group === undefined) groups.set(signature, [element]);
      else group.push(element);
    }
    return [...groups].map(([signature, elements]) => ({ signature, elements }));
  }
}

/** Per-resolution state: memoized coverage and the candidate set. */
class RegionScope {
  private readonly coverageCache = new Map<Element, number>();

  constructor(
    private readonly dom: DomQuery,
    private readonly polygon: Polygon,
    private readonly bounds: Rect,
    private readonly candidates: ReadonlySet<Element>,
    private readonly options: EnclosureOptions,
  ) {}

  selectWithin(root: Element): Element[] {
    const selected: Element[] = [];
    const visit = (element: Element): void => {
      if (this.isWhollyCircled(element)) {
        selected.push(element);
        return;
      }
      for (const child of this.dom.childrenOf(element)) {
        if (this.candidates.has(child)) visit(child);
      }
    };
    visit(root);
    return selected;
  }

  /** Children of the container next to or partially inside the lasso, nearest first. */
  neighborsIn(container: Element, selected: readonly Element[]): Element[] {
    const isRelatedToSelection = (element: Element): boolean =>
      selected.some(
        (chosen) =>
          chosen === element ||
          isAncestorOf(this.dom, element, chosen) ||
          isAncestorOf(this.dom, chosen, element),
      );

    return this.dom
      .childrenOf(container)
      .filter((child) => this.dom.isVisible(child) && !isRelatedToSelection(child))
      .map((child) => ({ child, distance: rectDistance(this.dom.rectOf(child), this.bounds) }))
      .filter(({ distance }) => distance <= this.options.neighborDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.options.maxNeighbors)
      .map(({ child }) => child);
  }

  private isWhollyCircled(element: Element): boolean {
    if (PAGE_ROOTS.has(element.localName) || !this.dom.isVisible(element)) return false;
    if (this.coverageOf(element) < this.options.wholeThreshold) return false;
    const area = rectArea(this.dom.rectOf(element));
    return this.dom
      .childrenOf(element)
      .filter(
        (child) =>
          this.dom.isVisible(child) &&
          rectArea(this.dom.rectOf(child)) >= area * this.options.significantChildShare,
      )
      .every((child) => this.coverageOf(child) >= this.options.outsideThreshold);
  }

  private coverageOf(element: Element): number {
    let value = this.coverageCache.get(element);
    if (value === undefined) {
      value = coverage(this.dom.rectOf(element), this.polygon);
      this.coverageCache.set(element, value);
    }
    return value;
  }
}
