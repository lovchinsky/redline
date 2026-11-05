import { describe, expect, it } from 'vitest';
import { DocumentDomQuery } from './dom-query';
import { sensitiveRects } from './privacy';
import { mount } from './testing/fixtures';

const FIELD_CSS =
  'input, iframe { display: block; width: 200px; height: 30px; margin: 10px; border: 0; }';

const masks = () => sensitiveRects(document, new DocumentDomQuery(document));
const yOf = (element: Element | null | undefined) => element?.getBoundingClientRect().y;

/** Sets a frame's document and waits for that document, not the initial blank one. */
const load = (frame: HTMLIFrameElement, html: string) =>
  new Promise<void>((resolve) => {
    frame.addEventListener(
      'load',
      () => {
        resolve();
      },
      { once: true },
    );
    frame.srcdoc = html;
  });

describe('sensitiveRects', () => {
  it('returns visible password, one-time-code and card fields only', () => {
    mount(
      `<input class="email" type="email" />
       <input class="pass" type="password" />
       <input class="otp" autocomplete="one-time-code" />
       <input class="card" autocomplete="cc-number" />
       <input class="hidden-pass" type="password" style="display: none" />`,
      FIELD_CSS,
    );
    expect(masks().map((rect) => rect.y)).toEqual(
      ['.pass', '.otp', '.card'].map((selector) => yOf(document.querySelector(selector))),
    );
  });

  it('keeps a revealed password masked by its name', () => {
    mount('<input class="shown" type="text" name="new_password" />', FIELD_CSS);
    expect(masks()).toHaveLength(1);
  });

  it('finds fields inside shadow roots', () => {
    mount('<login-box></login-box>', FIELD_CSS);
    const host = document.querySelector('login-box');
    const shadow = host?.attachShadow({ mode: 'open' });
    if (shadow === undefined) throw new Error('no shadow root');
    shadow.innerHTML = `<style>${FIELD_CSS}</style><input type="password" />`;
    expect(masks().map((rect) => rect.y)).toEqual([yOf(shadow.querySelector('input'))]);
  });

  it('masks frames it cannot inspect, such as hosted payment fields', () => {
    mount('<iframe class="pay" sandbox srcdoc="<p>4242 4242 4242 4242</p>"></iframe>', FIELD_CSS);
    expect(masks().map((rect) => rect.y)).toEqual([yOf(document.querySelector('.pay'))]);
  });

  it('looks into same-origin frames and places their fields on the page', async () => {
    mount(
      '<iframe class="login"></iframe>',
      'iframe { display: block; width: 300px; height: 120px; margin: 20px; border: 4px solid; }',
    );
    const frame = document.querySelector<HTMLIFrameElement>('.login');
    if (frame === null) throw new Error('no frame');
    await load(
      frame,
      '<body style="margin:0"><input style="box-sizing:border-box;display:block;margin:30px 0 0 15px;width:100px;height:20px" type="password"></body>',
    );
    const outer = frame.getBoundingClientRect();
    expect(masks()).toEqual([{ x: outer.x + 4 + 15, y: outer.y + 4 + 30, width: 100, height: 20 }]);
  });
});
