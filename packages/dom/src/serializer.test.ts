import { describe, expect, it } from 'vitest';
import { DocumentDomQuery } from './dom-query';
import { DEFAULT_SERIALIZE_OPTIONS, serializeElement } from './serializer';
import { mount } from './testing/fixtures';

const dom = () => new DocumentDomQuery(document);

describe('serializeElement', () => {
  it('keeps structure, test ids and text, and drops values, scripts and styles', () => {
    const page = mount(`
      <form class="signup" data-testid="signup" style="color: red" onclick="steal()">
        <label for="email">Email</label>
        <input id="email" type="email" name="email" value="me@acme.io" />
        <input type="password" value="hunter2" />
        <script>secret()</script>
        <button type="submit" class="cta">Join  now</button>
      </form>`);

    const { html, truncated } = serializeElement(dom(), page.get('.signup'), {
      ...DEFAULT_SERIALIZE_OPTIONS,
      marked: new Set([page.get('.cta')]),
    });

    expect(truncated).toBe(false);
    expect(html).toBe(
      [
        '<form class="signup" data-testid="signup">',
        '  <label for="email">Email</label>',
        '  <input id="email" type="email" name="email" />',
        '  <input type="password" />',
        '  <button type="submit" class="cta" data-redline="selected">Join now</button>',
        '</form>',
      ].join('\n'),
    );
    expect(html).not.toMatch(/me@acme|hunter2|secret|steal|color/);
  });

  it('summarizes long runs of identical siblings', () => {
    const page = mount(
      `<ul class="list">${'<li class="item"><a href="#">Item</a></li>'.repeat(6)}</ul>`,
    );
    const { html } = serializeElement(dom(), page.get('.list'));
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('<!-- …and 4 more like the above -->');
  });

  it('stops at the depth limit with a child count', () => {
    const page = mount(
      '<div class="a"><div class="b"><div class="c"><span>x</span><span>y</span></div></div></div>',
    );
    const { html } = serializeElement(dom(), page.get('.a'), {
      ...DEFAULT_SERIALIZE_OPTIONS,
      maxDepth: 2,
    });
    expect(html).toContain('<div class="c"><!-- 2 children --></div>');
  });

  it('respects the size budget', () => {
    const page = mount(
      `<section class="big">${'<p class="para">Lorem ipsum dolor sit amet</p><div class="other"></div>'.repeat(200)}</section>`,
    );
    const { html, truncated } = serializeElement(dom(), page.get('.big'), {
      ...DEFAULT_SERIALIZE_OPTIONS,
      keepRepeats: 1000,
      maxLength: 500,
    });
    expect(truncated).toBe(true);
    expect(html.length).toBeLessThan(600);
    expect(html.endsWith('<!-- truncated -->')).toBe(true);
  });

  it('renders media as opaque tags and follows open shadow roots', () => {
    const page = mount(
      '<div class="host-wrap"><x-card></x-card><svg class="icon"><path d="M0 0"/></svg></div>',
    );
    page.get('x-card').attachShadow({ mode: 'open' }).innerHTML = '<h3 class="title">Pro</h3>';
    const { html } = serializeElement(dom(), page.get('.host-wrap'));
    expect(html).toContain('<h3 class="title">Pro</h3>');
    expect(html).toContain('<svg class="icon" />');
    expect(html).not.toContain('path');
  });
});
