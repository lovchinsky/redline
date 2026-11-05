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

  /**
   * The stop before or after `from` in reading order, wrapping around. Walks from `from` only
   * as far as the next stop, so a key press costs a few elements, not the whole page.
   */
  private step(from: Element, direction: 1 | -1): Element | null {
    const move = (element: Element) =>
      direction === 1 ? this.following(element) : this.preceding(element);
    const restart = () =>
      direction === 1 ? this.following(this.root) : this.lastWithin(this.root);
    let wrapped = false;
    for (let node = move(from); ; node = move(node)) {
      if (node === null) {
        if (wrapped) return null;
        wrapped = true;
        node = restart();
        if (node === null) return null;
      }
      if (node === from) return wrapped && this.isVisibleStop(from) ? from : null;
      if (this.isVisibleStop(node)) return node;
    }
  }

  private isVisibleStop(element: Element): boolean {
    return element !== this.root && isStop(element) && this.dom.isVisible(element);
  }

  /** The element after `element` in flat-tree document order, or null after the last. */
  private following(element: Element): Element | null {
    const [child] = this.dom.childrenOf(element);
    if (child !== undefined) return child;
    for (let node = element; node !== this.root;) {
      const parent = this.dom.parentOf(node);
      if (parent === null) return null;
      const siblings = this.dom.childrenOf(parent);
      const index = siblings.indexOf(node);
      // Not rendered where its parent puts children (unslotted content): nothing follows.
      if (index === -1) return null;
      const next = siblings[index + 1];
      if (next !== undefined) return next;
      node = parent;
    }
    return null;
  }

  /** The element before `element` in flat-tree document order, or null before the first. */
  private preceding(element: Element): Element | null {
    if (element === this.root) return null;
    const parent = this.dom.parentOf(element);
    if (parent === null) return null;
    const siblings = this.dom.childrenOf(parent);
    const index = siblings.indexOf(element);
    if (index === -1) return null;
    const previous = siblings[index - 1];
    if (previous === undefined) return parent === this.root ? null : parent;
    return this.lastWithin(previous) ?? previous;
  }

  /** The last element inside `element` in document order (its deepest last descendant). */
  private lastWithin(element: Element): Element | null {
    let last: Element | null = null;
    for (let child = this.dom.childrenOf(element).at(-1); child !== undefined;) {
      last = child;
      child = this.dom.childrenOf(child).at(-1);
    }
    return last;
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
