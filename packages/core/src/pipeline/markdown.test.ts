import { describe, expect, it } from 'vitest';
import { code, escapeText, table, truncate } from './markdown';

describe('markdown helpers', () => {
  it('fences code spans longer than any backtick run inside', () => {
    expect(code('plan-card')).toBe('`plan-card`');
    expect(code('a `b` c')).toBe('``a `b` c``');
    expect(code('`edge`')).toBe('`` `edge` ``');
  });

  it('escapes structural characters in page text', () => {
    expect(escapeText('# Big *deal* | <b>')).toBe('\\# Big \\*deal\\* \\| \\<b\\>');
  });

  it('truncates on normalized whitespace', () => {
    expect(truncate('a   b\n c', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
  });

  it('builds tables with escaped pipes', () => {
    expect(table(['A', 'B'], [['1', 'x|y']])).toBe('| A | B |\n| --- | --- |\n| 1 | x\\|y |');
  });
});
