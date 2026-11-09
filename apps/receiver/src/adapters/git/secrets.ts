import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SecretFinding } from '../../domain/change-policy';
import { err, ok, type Fault } from '../../domain/result';
import type { Publishing } from '../../ports/publishing';

const run = promisify(execFile);

/**
 * Why gitleaks did not report. It exits with 0 whatever it finds, so it failed: as it will again
 * (it is missing, or cannot read the mirror), unless the system stopped it (e.g. out of memory).
 */
const faultOf = (error: unknown): Fault => {
  const signal =
    typeof error === 'object' && error !== null && 'signal' in error ? error.signal : null;
  return typeof signal === 'string'
    ? { transient: true, detail: `gitleaks was stopped (${signal})` }
    : { transient: false, detail: `gitleaks failed: ${String(error)}` };
};

const findingOf = (value: unknown): SecretFinding | null => {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const file = record['File'];
  const line = record['StartLine'];
  const rule = record['RuleID'];
  return typeof file === 'string' && typeof line === 'number' && typeof rule === 'string'
    ? { path: file, line, rule }
    : null;
};

/** Finds secrets in what the commits `baseSha..head` of a mirror add. */
export interface SecretFinder {
  find(
    mirror: string,
    baseSha: string,
    head: string,
  ): Promise<Publishing<readonly SecretFinding[]>>;
}

/**
 * No search for secrets: for repositories by path, whose changes stay in the operator's own
 * repository and are never pushed to a git host.
 */
export const NO_SECRET_SCAN: SecretFinder = { find: () => Promise.resolve(ok([])) };

/**
 * Secrets found by gitleaks. The change is the sandbox's, so nothing in it decides what gitleaks
 * reports: the mirror is bare (a `.gitleaks.toml` the change brings is not on disk), the ignore
 * file is looked for in an empty directory, and `gitleaks:allow` comments are not honoured.
 * Secrets are redacted in its report.
 */
export class GitleaksFinder implements SecretFinder {
  constructor(private readonly command: string) {}

  async find(
    mirror: string,
    baseSha: string,
    head: string,
  ): Promise<Publishing<readonly SecretFinding[]>> {
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-gitleaks-'));
    const report = path.join(scratch, 'report.json');
    try {
      await run(
        this.command,
        [
          'git',
          mirror,
          `--log-opts=${baseSha}..${head}`,
          '--report-format=json',
          `--report-path=${report}`,
          `--gitleaks-ignore-path=${scratch}`,
          '--ignore-gitleaks-allow',
          '--redact',
          '--no-banner',
          '--exit-code=0',
        ],
        {
          cwd: scratch,
          env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: scratch },
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      return await findingsIn(report);
    } catch (error) {
      return err(faultOf(error));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

/** The findings of a report gitleaks wrote; a report that does not read as one is a fault. */
const findingsIn = async (report: string): Promise<Publishing<readonly SecretFinding[]>> => {
  const parsed: unknown = await readFile(report, 'utf8').then(
    (text) => JSON.parse(text) as unknown,
    () => null,
  );
  return Array.isArray(parsed)
    ? ok(parsed.map(findingOf).filter((finding) => finding !== null))
    : err({ transient: false, detail: 'gitleaks wrote no report' });
};
