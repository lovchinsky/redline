import type { ResolvedRegion } from './types';

/**
 * The elements that stand for a region when looking at styles: the first element of each
 * group of identical siblings (three plan cards share their CSS), or the container when the
 * lasso circled no whole element.
 */
export const representativeElements = (region: ResolvedRegion, max: number): Element[] => {
  const firsts = region.groups.flatMap((group) => group.elements.slice(0, 1));
  return (firsts.length > 0 ? firsts : [region.container]).slice(0, max);
};
