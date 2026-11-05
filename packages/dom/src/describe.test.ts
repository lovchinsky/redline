import { describe, expect, it } from 'vitest';
import { describeElement } from './describe';
import { mount } from './testing/fixtures';

describe('describeElement', () => {
  it('prefers test ids, then authored ids, then authored classes', () => {
    const page = mount(`
      <div data-testid="plan-card" id="x" class="card"></div>
      <section id="pricing" class="wrap"></section>
      <button id=":r3:" class="css-1abc23 cta"></button>
      <app-widget></app-widget>`);
    expect(describeElement(page.get('[data-testid]'))).toBe('div[data-testid=plan-card]');
    expect(describeElement(page.get('section'))).toBe('section#pricing');
    expect(describeElement(page.get('button'))).toBe('button.cta');
    expect(describeElement(page.get('app-widget'))).toBe('app-widget');
  });
});
