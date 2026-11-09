import { describe, expect, it } from 'vitest';
import { fenced, subjectOf } from './change-request';

describe('subjectOf', () => {
  it.each([
    ['Make the cards equal height', 'Make the cards equal height'],
    ['Fix the hero\n\nand the footer', 'Fix the hero and the footer'],
    ['Closes #12, fixes acme/web#3', 'Closes # 12, fixes acme/web# 3'],
    ['Ask @ann and @acme/design', 'Ask @ ann and @ acme/design'],
    ['fixes https://github.com/acme/web/issues/1 now', 'fixes (link) now'],
    ['Email ann@example.com', 'Email ann@ example.com'],
  ])('%j becomes %j', (text, subject) => {
    expect(subjectOf(text)).toBe(subject);
  });

  it('keeps a subject to one short line', () => {
    const subject = subjectOf('word '.repeat(40));
    expect(subject.length).toBe(72);
    expect(subject.endsWith('…')).toBe(true);
  });
});

describe('fenced', () => {
  it('fences text longer than any backtick run in it', () => {
    expect(fenced('a ```` b')).toBe('`````text\na ```` b\n`````');
    expect(fenced('plain')).toBe('```text\nplain\n```');
  });
});
