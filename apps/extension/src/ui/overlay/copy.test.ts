import { describe, expect, it } from 'vitest';
import { UI_TEXT, describeResolution } from './copy';

describe('overlay copy', () => {
  it.each([
    [1, '1 область'],
    [2, '2 області'],
    [5, '5 областей'],
    [11, '11 областей'],
    [21, '21 область'],
  ])('pluralizes %i areas', (count, expected) => {
    expect(UI_TEXT.shapesTitle(count)).toBe(expected);
  });

  it('describes resolved regions', () => {
    expect(
      describeResolution({
        status: 'resolved',
        summary: {
          kind: 'elements',
          groups: [
            { label: 'div.card', count: 3 },
            { label: 'button.cta', count: 1 },
          ],
          container: 'div.grid',
          neighbors: [],
        },
      }),
    ).toBe('div.card ×3, button.cta');
    expect(
      describeResolution({
        status: 'resolved',
        summary: { kind: 'empty-space', groups: [], container: 'main', neighbors: [] },
      }),
    ).toBe('Порожнє місце в main');
  });
});
