import type { Polygon } from '@redline/geometry';

/**
 * - `elements`: one or more elements are wholly circled.
 * - `within-element`: the lasso lies inside one element and cuts through its content.
 * - `empty-space`: the lasso covers only an element's background (e.g. a gap between blocks).
 */
export type RegionKind = 'elements' | 'within-element' | 'empty-space';

/** Circled siblings that share a structure (e.g. three product cards), in document order. */
export interface ElementGroup {
  readonly signature: string;
  readonly elements: readonly Element[];
}

/**
 * What a lasso refers to on the page. Holds live element references, so it is only valid
 * inside the content script during capture and never leaves it.
 */
export interface ResolvedRegion {
  readonly kind: RegionKind;
  readonly polygon: Polygon;
  /** Empty unless `kind` is `elements`. */
  readonly groups: readonly ElementGroup[];
  /** Closest element that holds the whole region: the place where layout is decided. */
  readonly container: Element;
  /** Unselected elements next to or partially inside the region. */
  readonly neighbors: readonly Element[];
}

export interface RegionResolver {
  /** Returns null when the polygon is degenerate or covers nothing on the page. */
  resolve(polygon: Polygon): ResolvedRegion | null;
}
