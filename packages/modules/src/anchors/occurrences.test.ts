import { DocumentDomQuery } from '@redline/dom';
import { describe, expect, it } from 'vitest';
import type { AnchorCandidate } from './candidate';
import { MAX_INDEXED_ELEMENTS, indexOccurrences } from './occurrences';
import { mount } from '../testing/harness';

const candidate = (
  kind: AnchorCandidate['kind'],
  value: string,
  attribute: string | null = null,
): AnchorCandidate => ({ kind, value, raw: value, attribute, element: document.body });

describe('indexOccurrences', () => {
  it('counts values inside open shadow roots, as they render', () => {
    mount('<p class="price">Save 20%</p><price-card></price-card>', '');
    const host = document.querySelector('price-card');
    host
      ?.attachShadow({ mode: 'open' })
      .append(
        Object.assign(document.createElement('p'), { className: 'price', textContent: 'Save 20%' }),
      );
    const occurrences = indexOccurrences(new DocumentDomQuery(document), document);
    expect(occurrences.count(candidate('class', 'price'))).toBe(2);
    expect(occurrences.count(candidate('text', 'Save 20%'))).toBe(2);
    expect(occurrences.count(candidate('custom-tag', 'price-card'))).toBe(1);
  });

  it('ignores what the page does not render and what the extension adds', () => {
    mount(
      '<button name="save">Save</button><script>const label = "Save"</script><div id="overlay"><button name="save">Save</button></div>',
      '',
    );
    const dom = new DocumentDomQuery(document, (element) => element.id === 'overlay');
    const occurrences = indexOccurrences(dom, document);
    expect(occurrences.count(candidate('text', 'Save'))).toBe(1);
    expect(occurrences.count(candidate('name', 'save', 'name'))).toBe(1);
  });

  it('claims nothing about a page too large to count', () => {
    mount(`<ul>${'<li class="row">Row</li>'.repeat(MAX_INDEXED_ELEMENTS)}</ul>`, '');
    const occurrences = indexOccurrences(new DocumentDomQuery(document), document);
    expect(occurrences.count(candidate('class', 'row'))).toBeNull();
  });
});
