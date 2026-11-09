import { describe, expect, it } from 'vitest';
import { judgeToolUse, workspacePath } from './guard';

const protectedPaths = ['.github', 'CLAUDE.md', 'src/generated/**'];

describe('judgeToolUse', () => {
  it.each([
    ['Edit', { file_path: '/workspace/src/Card.css' }, true],
    ['Write', { file_path: 'src/Card.css' }, true],
    ['Edit', { file_path: '/workspace/web/CLAUDE.md' }, false],
    ['Write', { file_path: '/workspace/.github/workflows/ci.yml' }, false],
    ['Write', { file_path: '/workspace/src/generated/api.ts' }, false],
    ['Write', { file_path: '/workspace/src/../.github/x.yml' }, false],
    ['Write', { file_path: '/etc/passwd' }, false],
    ['Write', { file_path: '/workspace/../etc/passwd' }, false],
    ['Edit', { file_path: '/workspace/.git/config' }, false],
    ['Read', { file_path: '/workspace/CLAUDE.md' }, true],
    ['Bash', { command: 'cat CLAUDE.md' }, true],
  ])('%s %j allowed: %s', (tool, input, allowed) => {
    expect(judgeToolUse(tool, input, protectedPaths).allow).toBe(allowed);
  });

  it('tells the agent why', () => {
    expect(judgeToolUse('Edit', { file_path: 'CLAUDE.md' }, protectedPaths)).toEqual({
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
