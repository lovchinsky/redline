import { execFile, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Settings that keep git from running anything a repository or a change carries. */
const SAFE = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.file.allow=always',
  '-c',
  'safe.directory=*',
];

/** Settings for one call to reach `remote`: its authorization header, by environment only. */
export const reaching = (remote: {
  readonly authorization: string | null;
}): Record<string, string> =>
  remote.authorization === null
    ? {}
    : {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: ${remote.authorization}`,
      };

const environment = (extra: Readonly<Record<string, string>>) => ({
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: process.env['HOME'] ?? '/tmp',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  ...extra,
});

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
  ) {
    super(`git ${args.join(' ')}: ${stderr.trim()}`);
  }
}

/**
 * Runs git in `cwd` and returns its output, trimmed of the final newline; `input`, when given,
 * is its standard input.
 */
export const git = async (
  cwd: string,
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
  input?: Uint8Array,
): Promise<string> => {
  try {
    const running = run('git', [...SAFE, ...args], {
      cwd,
      env: environment(extra),
      maxBuffer: 64 * 1024 * 1024,
    });
    if (input !== undefined) running.child.stdin?.end(input);
    const { stdout } = await running;
    return stdout.replace(/\n$/, '');
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr)
        : String(error);
    throw new GitError(args, stderr);
  }
};

/** A command's standard output as a stream, failing it when the command fails. */
export const streamOf = (command: string, args: readonly string[], cwd: string): Readable => {
  const child = spawn(command, [...args], {
    cwd,
    env: environment({}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on('close', (code) => {
    if (code !== 0)
      child.stdout.destroy(new Error(`${command} failed (${String(code)}): ${stderr.trim()}`));
  });
  return child.stdout;
};
