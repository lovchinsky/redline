import type { Rect } from '@redline/geometry';
import type { DomQuery } from './dom-query';
import { ownText } from './text';

const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'label']);
const MEDIA = new Set(['img', 'svg', 'video', 'canvas', 'iframe']);
const HEADING = /^h[1-6]$/;
const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'checkbox', 'switch']);

const hasOwnText = (element: Element): boolean => ownText(element) !== '';

/** An element a person would point at: something to press, read or look at. */
const isStop = (element: Element): boolean => {
  const name = element.localName;
  return (
    INTERACTIVE.has(name) ||
    MEDIA.has(name) ||
    HEADING.test(name) ||
    INTERACTIVE_ROLES.has(element.getAttribute('role') ?? '') ||
    element.hasAttribute('tabindex') ||
    hasOwnText(element)
  );
};

const sameBox = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 1 &&
  Math.abs(a.y - b.y) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1;

/**
 * Keyboard navigation over the page, the alternative to drawing: Tab moves between the
 * elements a person would point at, in reading order; outer and inner walk the tree, skipping
 * wrappers that occupy exactly the same box, so every step is visible on screen.
 */
export class ElementTraversal {
  constructor(
    private readonly dom: DomQuery,
    private readonly root: Element,
  ) {}

  /** The first stop in the viewport, or the first stop at all. */
  first(viewport: Rect): Element | null {
    const stops = this.walk().filter(isStop);
    return (
      stops.find((element) => {
        const rect = this.dom.rectOf(element);
        return rect.y + rect.height > viewport.y && rect.y < viewport.y + viewport.height;
      }) ??
      stops[0] ??
      null
    );
  }

  next(from: Element): Element | null {
    return this.step(from, 1);
  }

  previous(from: Element): Element | null {
    return this.step(from, -1);
  }

  /** The nearest visible ancestor with a larger box, below the root. */
  outer(from: Element): Element | null {
    const box = this.dom.rectOf(from);
    for (
      let parent = this.dom.parentOf(from);
      parent !== null;
      parent = this.dom.parentOf(parent)
    ) {
      if (parent === this.root) return null;
      if (this.dom.isVisible(parent) && !sameBox(this.dom.rectOf(parent), box)) return parent;
    }
    return null;
  }

  /** The first visible descendant with a smaller box, breadth first. */
  inner(from: Element): Element | null {
    const box = this.dom.rectOf(from);
    const queue = [...this.dom.childrenOf(from)];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (this.dom.isVisible(next) && !sameBox(this.dom.rectOf(next), box)) return next;
      queue.push(...this.dom.childrenOf(next));
    }
    return null;
  }

  /** The stop before or after `from` in reading order, wrapping around. */
  private step(from: Element, direction: 1 | -1): Element | null {
    const order = this.walk();
    const position = order.indexOf(from);
    const stops = order.flatMap((element, index) => (isStop(element) ? [index] : []));
    if (stops.length === 0) return null;
    const target =
      direction === 1
        ? (stops.find((index) => index > position) ?? stops[0])
        : (stops.findLast((index) => index < position) ?? stops.at(-1));
    return target === undefined ? null : (order[target] ?? null);
  }

  /** Visible elements in flat-tree document order. */
  private walk(): Element[] {
    const order: Element[] = [];
    const visit = (element: Element) => {
      if (element !== this.root && this.dom.isVisible(element)) order.push(element);
      for (const child of this.dom.childrenOf(element)) visit(child);
    };
    visit(this.root);
    return order;
  }
}
