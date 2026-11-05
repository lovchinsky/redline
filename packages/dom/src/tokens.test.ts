import { describe, expect, it } from 'vitest';
import { authoredClassTokens, readToken } from './tokens';

/** Deterministic random strings over an alphabet, so every run checks the same hashes. */
const hashes = (alphabet: string, length: number, count = 300): string[] => {
  let seed = 0x2f6b_3c1d;
  const next = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return seed / 2 ** 32;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join(''),
  );
};

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE64_SAFE = `${LETTERS}0123456789_-`;

describe('readToken', () => {
  it.each([
    ['Card_title__aBcDe', 'title'],
    ['Button_root__Xk_-q', 'root'],
    ['Card_card-title__3xK9a', 'card-title'],
    ['styles__title___2Ka9c', 'title'],
    ['_title_1x2y3_5', 'title'],
    ['_promo_ustqz_1', 'promo'],
    ['_order_summary_abcde_7', 'order_summary'],
    ['css-1x2y3z-Button', 'Button'],
    ['Button__StyledButton-sc-1h74p4n-0', 'StyledButton'],
    ['Wrapper-sc-bdVaJa', 'Wrapper'],
  ])('finds the hand-written name inside %s', (token, authored) => {
    expect(readToken(token)).toEqual({ kind: 'scoped', authored });
  });

  it.each([
    'css-1x2y3z',
    'sc-bdVaJa',
    'sc-iqA-dsV',
    'jsx-1234567',
    'jss12',
    'svelte-1kd8x2',
    'astro-j7pv25f6',
    '_ngcontent-abc-c12',
    'ng-tns-c12-3',
    'ember42',
    ':r1:',
    '«r1»',
    '_r_1_',
    'radix-:r4:',
    'item-9b2f6c1e-8a4d-4d3e-9f1a-2b3c4d5e6f70',
  ])('knows who generated %s', (token) => {
    expect(readToken(token)).toEqual({ kind: 'generated' });
  });

  it.each([
    'plans-grid',
    'mt-4',
    'grid-cols-3',
    'card2',
    'icon24',
    'heading2',
    'card__title',
    'nav-bar__item--active',
    'block__elem_mod',
    'navItem',
    'hBkjaA',
  ])('takes %s as written', (token) => {
    expect(readToken(token)).toEqual({ kind: 'plain', authored: token });
  });

  it.each(['_3xK9a', 'a8F3x', 'x1lliihq', '1x2y3z'])(
    'flags %s as shaped like a digest',
    (token) => {
      expect(readToken(token)).toEqual({ kind: 'digest-like', authored: token });
    },
  );

  // The templates must hold for any hash, not only ones that happen to contain digits.
  it.each([
    ['css-loader', BASE64_SAFE, 5, (hash: string) => `Card_title__${hash}`, 'title'],
    ['postcss-modules', BASE36, 5, (hash: string) => `_title_${hash}_12`, 'title'],
    ['emotion', BASE36, 6, (hash: string) => `css-${hash}-Card`, 'Card'],
    // styled-components splits every `ad` in its hashes as `a-d`.
    [
      'styled-components',
      LETTERS,
      6,
      (hash: string) => `Card-sc-${hash.replace(/(a)(d)/gi, '$1-$2')}`,
      'Card',
    ],
  ] as const)('reads %s names whatever the hash', (_, alphabet, length, name, authored) => {
    for (const hash of hashes(alphabet, length)) {
      expect(readToken(name(hash)), name(hash)).toEqual({ kind: 'scoped', authored });
    }
  });

  it('treats any emotion or styled-components id without a label as generated', () => {
    for (const hash of hashes(BASE36, 6)) expect(readToken(`css-${hash}`).kind).toBe('generated');
    for (const hash of hashes(LETTERS, 6)) expect(readToken(`sc-${hash}`).kind).toBe('generated');
  });
});

describe('authoredClassTokens', () => {
  const classesOf = (className: string) => {
    const element = document.createElement('div');
    element.className = className;
    return authoredClassTokens(element).map((token) => token.authored);
  };

  it('drops the style names that follow styled-components ids, by position', () => {
    expect(classesOf('sc-bdVaJa hBkjaA gallery navItem')).toEqual(['gallery', 'navItem']);
    // Lowercase style names look like words; their position still gives them away.
    expect(classesOf('sc-bdVaJa sc-htpNat kxqvbe hjkwqp active')).toEqual(['active']);
    expect(classesOf('Card-sc-bdVaJa iA-dEz')).toEqual(['Card']);
    expect(classesOf('sc-iqA-dsV eBqqeC summary')).toEqual(['summary']);
  });

  it('expects at most one style name per component id', () => {
    expect(classesOf('sc-bdVaJa hBkjaA active')).toEqual(['active']);
    expect(classesOf('sc-bdVaJa hBkjaA sc-htpNat kxqvbe navbar')).toEqual(['navbar']);
  });

  it('keeps letter-only names away from component ids', () => {
    expect(classesOf('fPCDPa hBkjaA')).toEqual(['fPCDPa', 'hBkjaA']);
  });

  it('keeps the hand-written names inside CSS Modules classes', () => {
    expect(classesOf('card Card_root__a8F3x css-1x2y3z')).toEqual(['card', 'root']);
  });
});
