import { describe, expect, it } from 'vitest';
import { DocumentDomQuery } from './dom-query';
import { mount } from './testing/fixtures';
import { ElementTraversal } from './traversal';

const PAGE = `
  <header><h1>Shop</h1><a href="/cart">Cart</a></header>
  <main>
    <div class="wrap"><section class="card">
      <h2>Basic</h2>
      <p>For small teams</p>
      <button>Buy</button>
    </section></div>
    <div hidden><button>Ghost</button></div>
    <section class="card"><h2>Pro</h2><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20"></section>
  </main>`;

const setUp = () => {
  const page = mount(PAGE);
  const traversal = new ElementTraversal(new DocumentDomQuery(document), document.body);
  return { page, traversal };
};

const viewport = { x: 0, y: 0, width: 1280, height: 800 };

describe('ElementTraversal', () => {
  it('moves between things to read, press or look at, in reading order', () => {
    const { traversal } = setUp();
    const visited: string[] = [];
    let current = traversal.first(viewport);
    for (let i = 0; i < 8 && current !== null; i += 1) {
      const text = current.textContent.trim();
      visited.push(text === '' ? current.localName : `${current.localName}:${text}`);
      current = traversal.next(current);
    }
    expect(visited).toEqual([
      'h1:Shop',
      'a:Cart',
      'h2:Basic',
      'p:For small teams',
      'button:Buy',
      'h2:Pro',
      'img',
      'h1:Shop',
    ]);
  });

  it('goes back, wrapping around', () => {
    const { page, traversal } = setUp();
    expect(traversal.previous(page.get('h1'))?.localName).toBe('img');
    expect(traversal.previous(page.get('button'))?.textContent).toBe('For small teams');
  });

  it('walks out to containers, skipping wrappers of the same size', () => {
    const { page, traversal } = setUp();
    const card = traversal.outer(page.get('button'));
    expect(card).toBe(page.get('section.card'));
    expect(traversal.outer(card ?? document.body)).toBe(page.get('main'));
    expect(traversal.outer(page.get('main'))).toBeNull();
  });

  it('walks in to the first visible part', () => {
    const { page, traversal } = setUp();
    expect(traversal.inner(page.get('main'))).toBe(page.get('div.wrap'));
    expect(traversal.inner(page.get('section.card'))).toBe(page.get('section.card h2'));
    expect(traversal.inner(page.get('h1'))).toBeNull();
  });

  it('continues from a container to the first stop inside it', () => {
    const { page, traversal } = setUp();
    expect(traversal.next(page.get('section.card'))).toBe(page.get('section.card h2'));
  });
});
