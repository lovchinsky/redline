import type { Rect } from '@redline/geometry';
import type { DomQuery } from './dom-query';

/** `autocomplete` tokens for secrets and payment data. */
const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-[a-z-]+)\b/;

/** Fields whose pixels must never leave the device: passwords, one-time codes, card data. */
export const isSensitiveField = (element: Element): boolean => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
    return false;
  if (element instanceof HTMLInputElement && element.type === 'password') return true;
  return SENSITIVE_AUTOCOMPLETE.test(element.getAttribute('autocomplete') ?? '');
};

/** Viewport rectangles of visible sensitive fields, to be masked in screenshots. */
export const sensitiveRects = (document: Document, dom: DomQuery): Rect[] =>
  Array.from(document.querySelectorAll('input, textarea'))
    .filter((element) => isSensitiveField(element) && dom.isVisible(element))
    .map((element) => dom.rectOf(element));
