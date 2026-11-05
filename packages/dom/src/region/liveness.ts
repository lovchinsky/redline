import type { ResolvedRegion } from './types';

/**
 * Whether every element the region refers to is still on the page. A page that re-renders
 * (a framework replacing nodes while the user types the comment) leaves the region pointing
 * at detached elements, whose boxes and styles read as empty.
 */
export const isRegionLive = (region: ResolvedRegion): boolean =>
  region.container.isConnected &&
  region.neighbors.every((element) => element.isConnected) &&
  region.groups.every((group) => group.elements.every((element) => element.isConnected));
