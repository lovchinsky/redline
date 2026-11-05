import { authoredClassTokens } from '@redline/dom';
import type { AnchorCandidate, AnchorSource } from './candidate';
import type { AnchorKind } from './types';

const MAX_VALUE = 80;

const candidate = (
  kind: AnchorKind,
  value: string,
  element: Element,
  attribute: string | null = null,
  raw = value,
): AnchorCandidate => ({ kind, value: value.slice(0, MAX_VALUE), attribute, raw, element });

const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa'];

const ATTRIBUTE_KINDS: readonly (readonly [string, AnchorKind])[] = [
  ['aria-label', 'aria-label'],
  ['name', 'name'],
  ['placeholder', 'placeholder'],
  ['alt', 'alt'],
  ['title', 'title'],
];

/** Attributes developers write by hand: test ids, ids, accessible names, form names. */
export const attributeSource: AnchorSource = {
  id: 'attributes',
  extract: (element) => {
    const found: AnchorCandidate[] = [];
    for (const attribute of TEST_ID_ATTRIBUTES) {
      const value = element.getAttribute(attribute)?.trim();
      if (value) found.push(candidate('test-id', value, element, attribute));
    }
    if (element.id.trim() !== '') found.push(candidate('id', element.id.trim(), element, 'id'));
    for (const [attribute, kind] of ATTRIBUTE_KINDS) {
      const value = element.getAttribute(attribute)?.trim();
      if (value) found.push(candidate(kind, value, element, attribute));
    }
    return found;
  },
};

/** Custom element names match component selectors (Angular, Web Components) one to one. */
export const customTagSource: AnchorSource = {
  id: 'custom-tag',
  extract: (element) =>
    element.localName.includes('-') ? [candidate('custom-tag', element.localName, element)] : [],
};

/** The element's own text (not its descendants'), as written in templates or locale files. */
export const textSource: AnchorSource = {
  id: 'text',
  extract: (element) => {
    const text = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text === '' ? [] : [candidate('text', text, element)];
  },
};

/** Authored class names; generated hash segments are stripped, the raw token is kept for counting. */
export const classSource: AnchorSource = {
  id: 'classes',
  extract: (element) =>
    authoredClassTokens(element).map(({ raw, authored }) =>
      candidate('class', authored, element, 'class', raw),
    ),
};

/** In-app link targets point at routes, which appear in router configs. */
export const hrefSource: AnchorSource = {
  id: 'href',
  extract: (element) => {
    const href = element.localName === 'a' ? element.getAttribute('href')?.trim() : undefined;
    if (!href || href === '#' || /^(javascript|mailto|tel):/i.test(href)) return [];
    return [candidate('href', href, element, 'href')];
  },
};

export const DEFAULT_ANCHOR_SOURCES: readonly AnchorSource[] = [
  attributeSource,
  customTagSource,
  textSource,
  classSource,
  hrefSource,
];
