import { RUN_LAYOUT } from '@redline/agent-protocol';
import { firstMatch } from '@redline/path-patterns';

export type ToolDecision =
  { readonly allow: true } | { readonly allow: false; readonly reason: string };

/** A tool call, as far as the guard tells calls apart: one that writes the file at `path`, or any other. */
export type ToolUse =
  { readonly kind: 'write'; readonly path: string } | { readonly kind: 'other' };

const allow: ToolDecision = { allow: true };

/** `path` relative to the workspace, or null when it is outside of it. */
export const workspacePath = (path: string): string | null => {
  const segments: string[] = [];
  const absolute = path.startsWith('/') ? path : `${RUN_LAYOUT.workspace}/${path}`;
  for (const segment of absolute.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  const root = RUN_LAYOUT.workspace.split('/').filter(Boolean);
  if (root.some((segment, index) => segments[index] !== segment)) return null;
  const inside = segments.slice(root.length).join('/');
  return inside === '' ? null : inside;
};

/**
 * Whether a file tool may write where it asks to, by the project's protected paths. It tells
 * the agent at once, instead of after its budget is spent; the receiver's policy check of the
 * finished change is the one that holds, since the shell writes files too.
 */
export const judgeToolUse = (use: ToolUse, protectedPaths: readonly string[]): ToolDecision => {
  if (use.kind !== 'write') return allow;
  const path = workspacePath(use.path);
  if (path === null) {
    return { allow: false, reason: `Write only inside ${RUN_LAYOUT.workspace}.` };
  }
  if (path === '.git' || path.startsWith('.git/')) {
    return { allow: false, reason: 'The repository’s .git directory is not part of the change.' };
  }
  const pattern = firstMatch(protectedPaths, path);
  return pattern === null
    ? allow
    : {
        allow: false,
        reason: `${path} is protected by the project (${pattern}); a change to it is rejected.`,
      };
};
