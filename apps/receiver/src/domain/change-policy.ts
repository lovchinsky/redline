import { firstMatch } from '@redline/path-patterns';
/** One file of a proposed change, as git describes it against the task's base. */
export interface DiffEntry {
  readonly path: string;
  /** The path before a rename. */
  readonly previousPath: string | null;
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed';
  readonly mode: 'file' | 'executable' | 'symlink' | 'submodule';
  readonly binary: boolean;
  /** Size of the new content; 0 for a deleted file. */
  readonly bytes: number;
  readonly addedLines: number;
  readonly removedLines: number;
}

/** A secret a scanner found in the new content. */
export interface SecretFinding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
}

/** Scripts of a `package.json` whose commands the change adds, removes or rewrites. */
export interface ScriptChange {
  readonly path: string;
  readonly scripts: readonly string[];
}

export interface ChangeDescription {
  readonly entries: readonly DiffEntry[];
  readonly secrets: readonly SecretFinding[];
  readonly scriptChanges: readonly ScriptChange[];
}

/** A project's rules for agent changes. Paths are `@redline/path-patterns` globs. */
export interface ChangePolicyRules {
  /** Paths the agent must not touch: CI, hooks, agent configuration, registries. */
  readonly deny: readonly string[];
  /** Paths a reviewer must look at: the change is published, marked as needing attention. */
  readonly flag: readonly string[];
  readonly maxFiles: number;
  readonly maxChangedLines: number;
  readonly maxBinaryBytes: number;
}

export const DEFAULT_CHANGE_POLICY: ChangePolicyRules = {
  // Names, not paths: in a monorepo these sit in any package, not only at the root.
  deny: [
    '.github',
    '.gitlab-ci.yml',
    '.circleci',
    '.husky',
    '.pre-commit-config.yaml',
    '.git',
    'CLAUDE.md',
    '.claude',
    'AGENTS.md',
    '.mcp.json',
    '.vscode',
    '.devcontainer',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    'pip.conf',
    '.redline',
    'CODEOWNERS',
  ],
  flag: [
    'Dockerfile',
    'Makefile',
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
  ],
  maxFiles: 50,
  maxChangedLines: 2_000,
  maxBinaryBytes: 2 * 1024 * 1024,
};

export type Violation =
  | { readonly kind: 'denied-path'; readonly path: string; readonly pattern: string }
  | { readonly kind: 'special-file'; readonly path: string; readonly mode: 'symlink' | 'submodule' }
  | { readonly kind: 'made-executable'; readonly path: string }
  | { readonly kind: 'secret'; readonly path: string; readonly line: number; readonly rule: string }
  | { readonly kind: 'too-many-files'; readonly count: number; readonly limit: number }
  | { readonly kind: 'too-many-lines'; readonly count: number; readonly limit: number }
  | {
      readonly kind: 'binary-too-large';
      readonly path: string;
      readonly bytes: number;
      readonly limit: number;
    }
  | { readonly kind: 'empty' };

export type Flag =
  | { readonly kind: 'flagged-path'; readonly path: string; readonly pattern: string }
  | {
      readonly kind: 'scripts-changed';
      readonly path: string;
      readonly scripts: readonly string[];
    };

export type PolicyVerdict =
  | { readonly accepted: true; readonly flags: readonly Flag[] }
  | { readonly accepted: false; readonly violations: readonly Violation[] };

/** Every path an entry touches: a rename touches where the file was and where it is. */
const touchedPaths = (entry: DiffEntry): string[] =>
  entry.previousPath === null ? [entry.path] : [entry.previousPath, entry.path];

/**
 * Judges a proposed change. Rules are the boundary that holds whatever the agent was told:
 * the agent knows them from its brief, so a violation is a mistake or an attack, never routine.
 */
export const evaluateChange = (
  change: ChangeDescription,
  rules: ChangePolicyRules,
): PolicyVerdict => {
  const violations: Violation[] = [];
  const flags: Flag[] = [];
  if (change.entries.length === 0) violations.push({ kind: 'empty' });

  for (const entry of change.entries) {
    for (const path of touchedPaths(entry)) {
      const denied = firstMatch(rules.deny, path);
      if (denied !== null) violations.push({ kind: 'denied-path', path, pattern: denied });
      const flagged = firstMatch(rules.flag, path);
      if (denied === null && flagged !== null)
        flags.push({ kind: 'flagged-path', path, pattern: flagged });
    }
    if (entry.status !== 'deleted' && (entry.mode === 'symlink' || entry.mode === 'submodule')) {
      violations.push({ kind: 'special-file', path: entry.path, mode: entry.mode });
    }
    if (entry.status !== 'deleted' && entry.mode === 'executable') {
      violations.push({ kind: 'made-executable', path: entry.path });
    }
    if (entry.binary && entry.bytes > rules.maxBinaryBytes) {
      violations.push({
        kind: 'binary-too-large',
        path: entry.path,
        bytes: entry.bytes,
        limit: rules.maxBinaryBytes,
      });
    }
  }

  if (change.entries.length > rules.maxFiles) {
    violations.push({
      kind: 'too-many-files',
      count: change.entries.length,
      limit: rules.maxFiles,
    });
  }
  const lines = change.entries.reduce(
    (sum, entry) => sum + entry.addedLines + entry.removedLines,
    0,
  );
  if (lines > rules.maxChangedLines) {
    violations.push({ kind: 'too-many-lines', count: lines, limit: rules.maxChangedLines });
  }
  for (const secret of change.secrets) violations.push({ kind: 'secret', ...secret });
  for (const scripts of change.scriptChanges) {
    if (scripts.scripts.length > 0) flags.push({ kind: 'scripts-changed', ...scripts });
  }

  return violations.length === 0 ? { accepted: true, flags } : { accepted: false, violations };
};

/** One line per violation, for the requester and the task's history. */
export const describeViolation = (violation: Violation): string => {
  switch (violation.kind) {
    case 'denied-path':
      return `${violation.path} is protected (${violation.pattern})`;
    case 'special-file':
      return `${violation.path} is a ${violation.mode}`;
    case 'made-executable':
      return `${violation.path} is executable`;
    case 'secret':
      return `${violation.path}:${String(violation.line)} looks like a secret (${violation.rule})`;
    case 'too-many-files':
      return `${String(violation.count)} files changed, at most ${String(violation.limit)} allowed`;
    case 'too-many-lines':
      return `${String(violation.count)} lines changed, at most ${String(violation.limit)} allowed`;
    case 'binary-too-large':
      return `${violation.path} is a ${String(violation.bytes)}-byte binary, at most ${String(violation.limit)} allowed`;
    case 'empty':
      return 'the change is empty';
  }
};
