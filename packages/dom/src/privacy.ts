import type { Point, Rect } from '@redline/geometry';
import type { DomQuery } from './dom-query';

/** `autocomplete` tokens for secrets and payment data. */
const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/i;

/**
 * Names developers give secret and payment fields. They survive what `type` does not, such as a
 * "show password" toggle switching the field to `type="text"`.
 */
const SENSITIVE_NAME =
  /pass(word|wd)?|pwd|otp|one.?time|cvc|cvv|card.?(number|num|no)|cc.?(num|number)|iban|\bpin\b|secret/i;

/**
 * Fields whose pixels must never leave the device: passwords, one-time codes, card data.
 * Read from tag and attributes, not `instanceof`, so fields in same-origin frames (another
 * JavaScript realm) are recognised as well.
 */
export const isSensitiveField = (element: Element): boolean => {
  const tag = element.localName;
  if (tag !== 'input' && tag !== 'textarea') return false;
  if (tag === 'input' && element.getAttribute('type')?.toLowerCase() === 'password') return true;
  if (SENSITIVE_AUTOCOMPLETE.test(element.getAttribute('autocomplete') ?? '')) return true;
  return [element.getAttribute('name'), element.id].some(
    (value) => value !== null && value !== '' && SENSITIVE_NAME.test(value),
  );
};

/** The document inside a frame, or null when the page cannot read it (another origin, sandbox). */
const frameDocument = (frame: Element): Document | null => {
  try {
    return (frame as HTMLIFrameElement).contentDocument;
  } catch {
    return null;
  }
};

const shifted = (rect: Rect, by: Point): Rect => ({ ...rect, x: rect.x + by.x, y: rect.y + by.y });

/**
 * Viewport rectangles to mask in screenshots: visible sensitive fields anywhere in the flat tree
 * (shadow roots included), inside same-origin frames, and every frame whose content cannot be
 * inspected. Hosted payment fields live in such frames: what cannot be checked is not shown.
 */
export const sensitiveRects = (document: Document, dom: DomQuery): Rect[] => {
  const rects: Rect[] = [];
  const visit = (element: Element, offset: Point): void => {
    if (element.localName === 'iframe' || element.localName === 'frame') {
      if (!dom.isVisible(element)) return;
      const box = dom.rectOf(element);
      const inner = frameDocument(element);
      if (inner === null) {
        rects.push(shifted(box, offset));
        return;
      }
      // The frame's own viewport starts inside its border.
      visit(inner.documentElement, {
        x: offset.x + box.x + element.clientLeft,
        y: offset.y + box.y + element.clientTop,
      });
      return;
    }
    if (isSensitiveField(element)) {
      if (dom.isVisible(element)) rects.push(shifted(dom.rectOf(element), offset));
      return;
    }
    for (const child of dom.childrenOf(element)) visit(child, offset);
  };
  visit(document.documentElement, { x: 0, y: 0 });
  return rects;
};
