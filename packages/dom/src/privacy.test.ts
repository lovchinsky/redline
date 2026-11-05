import { describe, expect, it } from 'vitest';
import { DocumentDomQuery } from './dom-query';
import { sensitiveRects } from './privacy';
import { mount } from './testing/fixtures';

describe('sensitiveRects', () => {
  it('returns visible password, one-time-code and card fields only', () => {
    mount(
      `<input class="email" type="email" />
       <input class="pass" type="password" />
       <input class="otp" autocomplete="one-time-code" />
       <input class="card" autocomplete="cc-number" />
       <input class="hidden-pass" type="password" style="display: none" />`,
      'input { display: block; width: 200px; height: 30px; margin: 10px; }',
    );
    const rects = sensitiveRects(document, new DocumentDomQuery(document));
    const byClass = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().y;
    expect(rects.map((rect) => rect.y)).toEqual([
      byClass('.pass'),
      byClass('.otp'),
      byClass('.card'),
    ]);
  });
});
