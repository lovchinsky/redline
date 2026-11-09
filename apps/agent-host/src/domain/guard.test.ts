import { describe, expect, it } from 'vitest';
import { judgeToolUse, workspacePath, type ToolUse } from './guard';

const protectedPaths = ['.github', 'CLAUDE.md', 'src/generated/**'];

describe('judgeToolUse', () => {
  const write = (path: string): ToolUse => ({ kind: 'write', path });
  it.each([
    [write('/workspace/src/Card.css'), true],
    [write('src/Card.css'), true],
    [write('/workspace/web/CLAUDE.md'), false],
    [write('/workspace/.github/workflows/ci.yml'), false],
    [write('/workspace/src/generated/api.ts'), false],
    [write('/workspace/src/../.github/x.yml'), false],
    [write('/etc/passwd'), false],
    [write('/workspace/../etc/passwd'), false],
    [write('/workspace/.git/config'), false],
    [{ kind: 'other' } as const, true],
  ])('%j allowed: %s', (use, allowed) => {
    expect(judgeToolUse(use, protectedPaths).allow).toBe(allowed);
  });

  it('tells the agent why', () => {
    expect(judgeToolUse({ kind: 'write', path: 'CLAUDE.md' }, protectedPaths)).toEqual({
      allow: false,
      reason: 'CLAUDE.md is protected by the project (CLAUDE.md); a change to it is rejected.',
    });
  });
});

describe('workspacePath', () => {
  it('resolves inside the workspace only', () => {
    expect(workspacePath('/workspace/a/./b/../c.ts')).toBe('a/c.ts');
    expect(workspacePath('/workspace')).toBeNull();
    expect(workspacePath('/workspaces/x')).toBeNull();
  });
});
