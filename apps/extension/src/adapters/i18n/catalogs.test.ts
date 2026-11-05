import { describe, expect, it } from 'vitest';
import { PLURAL_FORMS } from '../../ports/i18n';
import { CATALOGS, translatorFor } from './testing/catalog-messages';

const { en, uk } = CATALOGS;

/** Highest `$n` a message uses: every translation must take the same substitutions. */
const arity = (message: string): number =>
  Math.max(0, ...[...message.matchAll(/\$([1-9])/g)].map((match) => Number(match[1])));

describe('message catalogs', () => {
  it('define the same messages in every language', () => {
    expect(Object.keys(uk).sort()).toEqual(Object.keys(en).sort());
  });

  it('take the same substitutions in every language', () => {
    for (const [key, { message }] of Object.entries(en)) {
      expect({ key, arity: arity(uk[key]?.message ?? '') }).toEqual({ key, arity: arity(message) });
    }
  });

  it('have no empty messages and no named placeholders', () => {
    for (const catalog of [en, uk]) {
      for (const [key, { message }] of Object.entries(catalog)) {
        expect({ key, empty: message.trim() === '' }).toEqual({ key, empty: false });
        expect({ key, named: /\$[a-z_]+\$/i.test(message) }).toEqual({ key, named: false });
      }
    }
  });

  it('define every plural form of a counted message', () => {
    const families = Object.keys(en).flatMap((key) => {
      const match = /^(.+)_other$/.exec(key);
      return match?.[1] === undefined ? [] : [match[1]];
    });
    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      for (const form of PLURAL_FORMS) expect(Object.keys(en)).toContain(`${family}_${form}`);
    }
  });

  it('keep store texts within Chrome Web Store limits', () => {
    for (const catalog of [en, uk]) {
      expect(catalog.extName?.message.length).toBeLessThanOrEqual(75);
      expect(catalog.extDescription?.message.length).toBeLessThanOrEqual(132);
    }
  });
});

describe('MessageTranslator', () => {
  it('names the language of the catalog in use', () => {
    expect(translatorFor('uk').locale).toBe('uk');
    expect(translatorFor('en').locale).toBe('en');
  });

  it('substitutes by position', () => {
    expect(translatorFor('en').text('stateRetryAt', 'offline', '10:30')).toBe(
      'Failed: offline. Next attempt at 10:30',
    );
  });

  it.each([
    [1, '1 крок'],
    [2, '2 кроки'],
    [5, '5 кроків'],
    [11, '11 кроків'],
    [21, '21 крок'],
    [1.5, '1,5 кроку'],
  ])('picks the Ukrainian plural form for %d', (count, expected) => {
    expect(translatorFor('uk').count('stepCount', count)).toBe(expected);
  });

  it('picks the English plural form', () => {
    const t = translatorFor('en');
    expect([t.count('areaCount', 1), t.count('areaCount', 3)]).toEqual(['1 area', '3 areas']);
  });

  it('formats numbers for the catalog language', () => {
    expect(translatorFor('uk').number(1234.5)).toBe('1\u00a0234,5');
    expect(translatorFor('en').number(1234.5)).toBe('1,234.5');
  });
});
