import { describe, expect, it } from 'vitest';
import { firstMatch, pathMatcher } from './index';

describe('pathMatcher', () => {
  it.each([
    ['.github/**', '.github/workflows/ci.yml', true],
    ['.github/**', 'web/.github/x', false],
    ['CLAUDE.md', 'CLAUDE.md', true],
    ['CLAUDE.md', 'apps/web/CLAUDE.md', true],
    ['CLAUDE.md', 'CLAUDE.md.bak', false],
    ['.claude', '.claude/settings.json', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/deep/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/deep/er/a.ts', true],
    ['.yarnrc', '.yarnrc.yml', false],
    ['file?.txt', 'file1.txt', true],
    ['a+b.txt', 'a+b.txt', true],
    ['a+b.txt', 'aab.txt', false],
  ])('%s matches %s: %s', (pattern, path, expected) => {
    expect(pathMatcher(pattern)(path)).toBe(expected);
  });

  it('names the first pattern that matches', () => {
    expect(firstMatch(['.github', 'CLAUDE.md'], 'web/CLAUDE.md')).toBe('CLAUDE.md');
    expect(firstMatch(['.github'], 'src/a.ts')).toBeNull();
  });
});
