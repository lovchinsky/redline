import type { DomQuery } from './dom-query';

/** Flat-tree path from the root down to the element (inclusive). */
export const pathTo = (dom: DomQuery, element: Element): Element[] => {
  const path: Element[] = [];
  for (let current: Element | null = element; current !== null; current = dom.parentOf(current)) {
    path.push(current);
  }
  return path.reverse();
};

export const isAncestorOf = (dom: DomQuery, ancestor: Element, element: Element): boolean => {
  for (let current = dom.parentOf(element); current !== null; current = dom.parentOf(current)) {
    if (current === ancestor) return true;
  }
  return false;
};

/** Deepest element that is, or contains, every given element in the flat tree. */
export const lowestCommonAncestor = (
  dom: DomQuery,
  elements: readonly [Element, ...Element[]],
): Element => {
  const [first, ...rest] = elements;
  let common = pathTo(dom, first);
  for (const element of rest) {
    const path = pathTo(dom, element);
    let shared = 0;
    while (shared < common.length && shared < path.length && common[shared] === path[shared]) {
      shared += 1;
    }
    common = common.slice(0, shared);
  }
  // Every flat-tree path starts at the document element, so `common` keeps at least that.
  return common.at(-1) ?? first;
};

/** Flat-tree document order: negative if `a` comes first; ancestors precede descendants. */
export const compareTreeOrder = (dom: DomQuery, a: Element, b: Element): number => {
  if (a === b) return 0;
  const pathA = pathTo(dom, a);
  const pathB = pathTo(dom, b);
  let depth = 0;
  while (depth < pathA.length && depth < pathB.length && pathA[depth] === pathB[depth]) depth += 1;
  const branchA = pathA[depth];
  const branchB = pathB[depth];
  if (branchA === undefined) return -1;
  if (branchB === undefined) return 1;
  const parent = pathA[depth - 1];
  if (parent === undefined) return 0;
  const siblings = dom.childrenOf(parent);
  return siblings.indexOf(branchA) - siblings.indexOf(branchB);
};
