import type { Point, Rect } from '@redline/geometry';

/**
 * Read-only view of the rendered page in viewport coordinates, following the flat tree:
 * open shadow roots and slot assignments are traversed as the user sees them.
 */
export interface DomQuery {
  /** Topmost hit-testable element at a viewport point, or null. Never returns ignored elements. */
  topmostAt(point: Point): Element | null;
  rectOf(element: Element): Rect;
  /** Rendered, not hidden by `visibility`/`opacity`, and with a non-empty box. */
  isVisible(element: Element): boolean;
  /** Flat-tree parent: the slot for slotted elements, the host for shadow root children. */
  parentOf(element: Element): Element | null;
  /** Flat-tree children: shadow content for open hosts, assigned elements for slots. */
  childrenOf(element: Element): readonly Element[];
  /** Whether the element's own text (not its children's) is rendered at any of the points. */
  hasOwnTextAt(element: Element, points: readonly Point[]): boolean;
}

export type IgnorePredicate = (element: Element) => boolean;

const toRect = (r: DOMRectReadOnly): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

const contains = (r: DOMRectReadOnly, p: Point): boolean =>
  p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;

export class DocumentDomQuery implements DomQuery {
  constructor(
    private readonly document: Document,
    private readonly isIgnored: IgnorePredicate = () => false,
  ) {}

  topmostAt(point: Point): Element | null {
    let element = this.firstHit(this.document, point);
    while (element?.shadowRoot) {
      const root = element.shadowRoot;
      const inner = this.firstHit(root, point, (candidate) => candidate.getRootNode() === root);
      if (inner === null) break;
      element = inner;
    }
    return element;
  }

  rectOf(element: Element): Rect {
    return toRect(element.getBoundingClientRect());
  }

  isVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    );
  }

  parentOf(element: Element): Element | null {
    if (element.assignedSlot !== null) return element.assignedSlot;
    if (element.parentElement !== null) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  childrenOf(element: Element): readonly Element[] {
    if (element instanceof HTMLSlotElement) return element.assignedElements({ flatten: true });
    const source = element.shadowRoot ?? element;
    return Array.from(source.children);
  }

  hasOwnTextAt(element: Element, points: readonly Point[]): boolean {
    const range = this.document.createRange();
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() === '') continue;
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects());
      if (points.some((point) => rects.some((rect) => contains(rect, point)))) return true;
    }
    return false;
  }

  private firstHit(
    scope: Document | ShadowRoot,
    point: Point,
    accept: (element: Element) => boolean = () => true,
  ): Element | null {
    return (
      scope
        .elementsFromPoint(point.x, point.y)
        .find((element) => accept(element) && !this.isIgnoredInFlatTree(element)) ?? null
    );
  }

  /** An element is ignored if it, or any flat-tree ancestor, matches the predicate. */
  private isIgnoredInFlatTree(element: Element): boolean {
    for (
      let current: Element | null = element;
      current !== null;
      current = this.parentOf(current)
    ) {
      if (this.isIgnored(current)) return true;
    }
    return false;
  }
}
