import { describeElement } from '../describe';
import type { RegionKind, ResolvedRegion } from './types';

/** Serializable description of a resolved region, safe to show in UI and send across contexts. */
export interface RegionSummary {
  readonly kind: RegionKind;
  readonly groups: readonly { readonly label: string; readonly count: number }[];
  readonly container: string;
  readonly neighbors: readonly string[];
}

export const summarizeRegion = (region: ResolvedRegion): RegionSummary => ({
  kind: region.kind,
  groups: region.groups.map((group) => ({
    label: group.elements[0] === undefined ? '' : describeElement(group.elements[0]),
    count: group.elements.length,
  })),
  container: describeElement(region.container),
  neighbors: region.neighbors.map(describeElement),
});
