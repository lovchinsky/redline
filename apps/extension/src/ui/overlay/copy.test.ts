import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../adapters/i18n/testing/catalog-messages';
import { describeResolution } from './copy';

describe('overlay copy', () => {
  it('describes resolved regions', () => {
    const t = translatorFor('uk');
    expect(
      describeResolution(t, {
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
      describeResolution(t, {
        status: 'resolved',
        summary: { kind: 'empty-space', groups: [], container: 'main', neighbors: [] },
      }),
    ).toBe('Порожнє місце в main');
  });

  it('speaks the catalog language', () => {
    expect(describeResolution(translatorFor('en'), { status: 'empty' })).toBe('Nothing found');
  });
});
