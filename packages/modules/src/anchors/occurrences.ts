import { ownText, type DomQuery } from '@redline/dom';
import type { AnchorCandidate } from './candidate';

/**
 * Pages larger than this are not counted: a walk that stops early would call a value unique
 * because its other occurrences were never reached.
 */
export const MAX_INDEXED_ELEMENTS = 30_000;

/** How many times each searchable value occurs on the page. */
export interface Occurrences {
  /** Elements carrying the candidate's value; `null` when the page was too large to count. */
  count(candidate: AnchorCandidate): number | null;
}

/** Tags, class tokens and attribute values each count in their own namespace. */
const tagKey = (name: string) => `tag\u0000${name}`;
const classKey = (token: string) => `class\u0000${token}`;
const attributeKey = (name: string, value: string) => `attribute\u0000${name}\u0000${value}`;

/** Text nobody sees on the page: code and markup kept for later. */
const UNRENDERED_TEXT = new Set(['script', 'style', 'noscript', 'template']);

/**
 * Counts every tag, class and attribute value, and keeps every element's own text, in one walk
 * of the flat tree: what is inside open shadow roots counts as it renders, and the extension's
 * own elements (which `dom` hides) do not count at all.
 */
export const indexOccurrences = (dom: DomQuery, document: Document): Occurrences => {
  const counts = new Map<string, number>();
  const texts: string[] = [];
  const bump = (entry: string) => counts.set(entry, (counts.get(entry) ?? 0) + 1);

  const pending: Element[] = [document.documentElement];
  let indexed = 0;
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    // The head describes the page; what people see and search for is everything else.
    if (element.localName === 'head') continue;
    if (indexed === MAX_INDEXED_ELEMENTS) return { count: () => null };
    indexed += 1;
    bump(tagKey(element.localName));
    for (const token of Array.from(element.classList)) bump(classKey(token));
    for (const attribute of Array.from(element.attributes)) {
      bump(attributeKey(attribute.name, attribute.value.trim()));
    }
    const text = UNRENDERED_TEXT.has(element.localName) ? '' : ownText(element);
    if (text !== '') texts.push(text);
    pending.push(...dom.childrenOf(element));
  }

  return {
    count: (candidate) => {
      switch (candidate.kind) {
        case 'text':
          // Searched as a substring, as a code search would find it.
          return texts.filter((text) => text.includes(candidate.value)).length;
        case 'custom-tag':
          return counts.get(tagKey(candidate.value)) ?? 0;
        case 'class':
          return counts.get(classKey(candidate.raw)) ?? 0;
        default:
          return candidate.attribute === null
            ? 0
            : (counts.get(attributeKey(candidate.attribute, candidate.raw)) ?? 0);
      }
    },
  };
};
