import { describe, expect, it } from 'vitest';
import { DocumentDomQuery } from '../dom-query';
import { circleAround, ellipseIn, mount, tightCircle } from '../testing/fixtures';
import { EnclosureResolver } from './enclosure-resolver';
import type { ResolvedRegion } from './types';

const resolver = (ignore?: (element: Element) => boolean) =>
  new EnclosureResolver(new DocumentDomQuery(document, ignore));

const resolve = (polygon: Parameters<EnclosureResolver['resolve']>[0]): ResolvedRegion => {
  const region = resolver().resolve(polygon);
  if (region === null) throw new Error('Expected a resolved region');
  return region;
};

const selectedOf = (region: ResolvedRegion): Element[] =>
  region.groups.flatMap((group) => [...group.elements]);

const CARDS_CSS = `
  .grid { display: flex; gap: 24px; padding: 24px; }
  .card { width: 200px; height: 160px; padding: 12px; border: 1px solid #ccc; }
  .card h3 { margin: 0 0 8px; } .card p { margin: 0; }
`;
const card = (n: number) =>
  `<div class="card" id="c${String(n)}"><h3>Plan ${String(n)}</h3><p>Text</p></div>`;

describe('EnclosureResolver', () => {
  it('1 · selects three of four repeated cards as one group inside their grid', () => {
    const page = mount(
      `<main><div class="grid">${[1, 2, 3, 4].map(card).join('')}</div></main>`,
      CARDS_CSS,
    );
    const cards = ['#c1', '#c2', '#c3'].map(page.get);

    const region = resolve(circleAround(cards));

    expect(region.kind).toBe('elements');
    expect(region.groups).toHaveLength(1);
    expect(region.groups[0]?.elements).toEqual(cards);
    expect(region.container).toBe(page.get('.grid'));
    expect(region.neighbors).toContain(page.get('#c4'));
  });

  it('2 · a tight lasso that clips the corners still selects the element', () => {
    const page = mount(
      `<div class="bar"><span>Total</span><button class="cta">Buy now</button></div>`,
      `.bar { display: flex; justify-content: space-between; padding: 40px; }
       .cta { width: 160px; height: 48px; }`,
    );

    const region = resolve(tightCircle([page.get('.cta')]));

    expect(selectedOf(region)).toEqual([page.get('.cta')]);
    expect(region.container).toBe(page.get('.bar'));
  });

  it('3 · leaving a significant part outside selects the parts that were circled', () => {
    const page = mount(
      `<article class="panel"><header class="head">Title</header>
         <section class="body">Body</section><footer class="foot">Footer</footer></article>`,
      `.panel { width: 400px; margin: 40px; } .head { height: 60px; } .body { height: 140px; }
       .foot { height: 120px; }`,
    );

    const region = resolve(circleAround([page.get('.head'), page.get('.body')], 4));

    expect(region.kind).toBe('elements');
    expect(selectedOf(region)).toEqual([page.get('.head'), page.get('.body')]);
    expect(region.groups).toHaveLength(2);
    expect(region.container).toBe(page.get('.panel'));
    expect(region.neighbors).toContain(page.get('.foot'));
  });

  it('4 · a lasso in the gap between sections is empty space with both sections as neighbors', () => {
    const page = mount(
      `<main class="page"><section class="a">A</section><section class="b">B</section></main>`,
      `.page { padding: 20px; } .a, .b { height: 200px; background: #eee; }
       .a { margin-bottom: 120px; }`,
    );
    const a = page.get('.a').getBoundingClientRect();

    const region = resolve(
      ellipseIn({ x: a.left + 100, y: a.bottom + 30, width: 300, height: 60 }),
    );

    expect(region.kind).toBe('empty-space');
    expect(region.container).toBe(page.get('.page'));
    expect(region.neighbors).toEqual(expect.arrayContaining([page.get('.a'), page.get('.b')]));
  });

  it('5 · a lasso over a few words inside a paragraph is within that element', () => {
    const page = mount(
      `<p class="copy">${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12)}</p>`,
      `.copy { width: 600px; margin: 40px; }`,
    );
    const p = page.get('.copy').getBoundingClientRect();

    const region = resolve(ellipseIn({ x: p.left + 40, y: p.top + 20, width: 200, height: 50 }));

    expect(region.kind).toBe('within-element');
    expect(region.container).toBe(page.get('.copy'));
  });

  it('6 · content hidden under a modal is never selected', () => {
    const page = mount(
      `<main class="behind">${'<button class="under">Under</button>'.repeat(6)}</main>
       <div class="backdrop"><div class="dialog"><button class="ok">OK</button>
         <button class="cancel">Cancel</button></div></div>`,
      `.under { display: block; width: 300px; height: 60px; margin: 8px; }
       .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 0.4); }
       .dialog { position: absolute; left: 0; top: 0; width: 420px; padding: 24px; background: white; }
       .ok, .cancel { width: 120px; height: 40px; }`,
    );

    const region = resolve(circleAround([page.get('.ok'), page.get('.cancel')]));
    const selected = selectedOf(region);

    expect(selected).toEqual([page.get('.ok'), page.get('.cancel')]);
    expect(selected.some((element) => element.classList.contains('under'))).toBe(false);
  });

  it('7 · resolves elements inside an open shadow root', () => {
    const page = mount(
      `<div class="host-wrap"><pricing-widget></pricing-widget></div>`,
      '.host-wrap { padding: 40px; }',
    );
    const host = page.get('pricing-widget');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>:host { display: flex; gap: 120px; } button { width: 180px; height: 50px; }</style>
      <button class="buy">Buy</button><button class="trial">Try free</button>`;
    const button = shadow.querySelector('.buy');
    if (button === null) throw new Error('fixture');

    const region = resolve(circleAround([button]));

    expect(selectedOf(region)).toEqual([button]);
    expect(region.container).toBe(host);
  });

  it('8 · partially crossed neighbors are reported but not selected', () => {
    const page = mount(
      `<div class="row"><div class="box" id="l">L</div><div class="box" id="m">M</div>
       <div class="box" id="r">R</div></div>`,
      `.row { display: flex; gap: 16px; padding: 40px; } .box { width: 160px; height: 120px; background: #ddd; }`,
    );
    const left = page.get('#l').getBoundingClientRect();
    const right = page.get('#r').getBoundingClientRect();

    const region = resolve(
      ellipseIn({
        x: left.left + 70,
        y: left.top - 40,
        width: right.right - 70 - (left.left + 70),
        height: 200,
      }),
    );

    expect(selectedOf(region)).toEqual([page.get('#m')]);
    expect(region.neighbors).toEqual(expect.arrayContaining([page.get('#l'), page.get('#r')]));
  });

  it('9 · invisible elements are not selected', () => {
    const page = mount(
      `<div class="grid"><div class="card" id="shown">Shown</div>
       <div class="card" id="transparent" style="opacity: 0">Transparent</div>
       <div class="card" id="hidden" style="visibility: hidden">Hidden</div></div>`,
      CARDS_CSS,
    );

    const region = resolve(circleAround([page.get('#shown'), page.get('#hidden')]));

    expect(selectedOf(region)).toEqual([page.get('#shown')]);
  });

  it('10 · circling a whole navigation selects the nav, not each link', () => {
    const page = mount(
      `<header class="top"><nav class="menu">${['Home', 'Pricing', 'Docs', 'Blog', 'Login']
        .map((label) => `<a href="#">${label}</a>`)
        .join('')}</nav><div class="spacer"></div></header>`,
      `.top { display: flex; padding: 16px; } .menu { display: flex; gap: 24px; }
       .spacer { width: 600px; height: 40px; }`,
    );

    const region = resolve(circleAround([page.get('.menu')]));

    expect(selectedOf(region)).toEqual([page.get('.menu')]);
    expect(region.container).toBe(page.get('.top'));
  });

  it('11 · groups circled siblings by structure, in document order', () => {
    const page = mount(
      `<div class="toolbar"><a class="link" href="#">Edit</a><a class="link" href="#">Share</a>
       <button class="action">Export</button><div class="rest"></div></div>`,
      `.toolbar { display: flex; gap: 12px; padding: 24px; align-items: center; }
       .link, .action { display: block; width: 90px; height: 36px; } .rest { width: 700px; height: 200px; }`,
    );
    const links = [page.get('.link:nth-child(1)'), page.get('.link:nth-child(2)')];

    const region = resolve(circleAround([...links, page.get('.action')]));

    expect(region.groups.map((group) => group.elements)).toEqual([links, [page.get('.action')]]);
    expect(region.container).toBe(page.get('.toolbar'));
  });

  it('12 · ignored elements (the capture overlay) are transparent to resolution', () => {
    const page = mount(
      `<button class="target">Target</button><div class="overlay"></div>`,
      `.target { margin: 60px; width: 200px; height: 60px; }
       .overlay { position: fixed; inset: 0; }`,
    );
    const overlay = page.get('.overlay');

    const region = resolver((element) => element === overlay).resolve(
      circleAround([page.get('.target')]),
    );

    expect(region === null ? [] : selectedOf(region)).toEqual([page.get('.target')]);
  });

  it('returns null for a degenerate polygon', () => {
    mount('<div>content</div>');
    expect(
      resolver().resolve([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBeNull();
  });
});
