import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANGE_POLICY,
  describeViolation,
  evaluateChange,
  globMatcher,
  type ChangeDescription,
  type DiffEntry,
} from './change-policy';

const entry = (path: string, overrides: Partial<DiffEntry> = {}): DiffEntry => ({
  path,
  previousPath: null,
  status: 'modified',
  mode: 'file',
  binary: false,
  bytes: 100,
  addedLines: 1,
  removedLines: 1,
  ...overrides,
});

const change = (
  entries: DiffEntry[],
  extra: Partial<ChangeDescription> = {},
): ChangeDescription => ({
  entries,
  secrets: [],
  scriptChanges: [],
  ...extra,
});

const verdict = (description: ChangeDescription) =>
  evaluateChange(description, DEFAULT_CHANGE_POLICY);

describe('globMatcher', () => {
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
  ])('%s matches %s: %s', (pattern, path, expected) => {
    expect(globMatcher(pattern)(path)).toBe(expected);
  });
});

describe('evaluateChange', () => {
  it('accepts an ordinary change to source files', () => {
    expect(verdict(change([entry('src/PlanCard.tsx'), entry('src/plan-card.css')]))).toEqual({
      accepted: true,
      flags: [],
    });
  });

  it('rejects protected paths, including where a rename comes from', () => {
    const result = verdict(
      change([
        entry('.github/workflows/ci.yml'),
        entry('docs/notes.md', { status: 'renamed', previousPath: 'CLAUDE.md' }),
        entry('packages/web/.claude/settings.json', { status: 'added' }),
      ]),
    );
    expect(result).toEqual({
      accepted: false,
      violations: [
        { kind: 'denied-path', path: '.github/workflows/ci.yml', pattern: '.github' },
        { kind: 'denied-path', path: 'CLAUDE.md', pattern: 'CLAUDE.md' },
        { kind: 'denied-path', path: 'packages/web/.claude/settings.json', pattern: '.claude' },
      ],
    });
  });

  it('rejects symlinks, submodules and executables, but not their removal', () => {
    const result = verdict(
      change([
        entry('link', { mode: 'symlink', status: 'added' }),
        entry('vendor/lib', { mode: 'submodule' }),
        entry('run.sh', { mode: 'executable', status: 'added' }),
        entry('old-link', { mode: 'symlink', status: 'deleted' }),
      ]),
    );
    expect(result.accepted ? [] : result.violations.map((v) => v.kind)).toEqual([
      'special-file',
      'special-file',
      'made-executable',
    ]);
  });

  it('rejects secrets, oversized changes and empty changes', () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      entry(`src/f${String(i)}.ts`, { addedLines: 50 }),
    );
    const result = verdict(
      change(many, { secrets: [{ path: 'src/f1.ts', line: 3, rule: 'github-token' }] }),
    );
    expect(result.accepted ? [] : result.violations.map((v) => v.kind)).toEqual([
      'too-many-files',
      'too-many-lines',
      'secret',
    ]);
    expect(verdict(change([]))).toEqual({ accepted: false, violations: [{ kind: 'empty' }] });
  });

  it('rejects large binaries only', () => {
    const result = verdict(
      change([
        entry('logo.png', { binary: true, bytes: 10_000 }),
        entry('video.mp4', { binary: true, bytes: 3 * 1024 * 1024 }),
      ]),
    );
    expect(result.accepted ? [] : result.violations).toEqual([
      {
        kind: 'binary-too-large',
        path: 'video.mp4',
        bytes: 3 * 1024 * 1024,
        limit: 2 * 1024 * 1024,
      },
    ]);
  });

  it('publishes but flags what a reviewer must look at', () => {
    const result = verdict(
      change([entry('apps/web/package.json'), entry('Dockerfile')], {
        scriptChanges: [{ path: 'apps/web/package.json', scripts: ['postinstall'] }],
      }),
    );
    expect(result).toEqual({
      accepted: true,
      flags: [
        { kind: 'flagged-path', path: 'apps/web/package.json', pattern: 'package.json' },
        { kind: 'flagged-path', path: 'Dockerfile', pattern: 'Dockerfile' },
        { kind: 'scripts-changed', path: 'apps/web/package.json', scripts: ['postinstall'] },
      ],
    });
  });

  it('describes every violation in one line', () => {
    expect(describeViolation({ kind: 'denied-path', path: '.npmrc', pattern: '.npmrc' })).toBe(
      '.npmrc is protected (.npmrc)',
    );
    expect(describeViolation({ kind: 'secret', path: 'a.ts', line: 3, rule: 'aws' })).toBe(
      'a.ts:3 looks like a secret (aws)',
    );
  });
});
