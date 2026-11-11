import { describe, expect, it } from 'vitest';
import { translatorFor } from './testing/catalog-messages';

const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 10, day, hour, minute).getTime();

describe('MessageTranslator.moment', () => {
  const t = translatorFor('uk');
  const now = at(11, 18, 0);

  it('shows only hours and minutes for a moment earlier the same day', () => {
    expect(t.moment(at(11, 9, 5), now)).toBe(t.time(at(11, 9, 5)));
  });

  it('adds the date for a moment on an earlier day', () => {
    const yesterday = t.moment(at(10, 23, 59), now);
    expect(yesterday).toContain('10.11');
    expect(yesterday).toContain('23:59');
  });
});
