import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SecretFinding } from '../../domain/change-policy';
import { err, ok, type Fault } from '../../domain/result';
import type { ChangeRef } from '../../domain/work';
import type { RepositoryRef } from '../../ports/access';
import type { Publishing, SecretScanner } from '../../ports/publishing';
import type { GitMirrors } from './git-mirrors';

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

/**
 * Secrets in what a change adds, found by gitleaks in the change's commit on the mirror. The
 * change is the sandbox's, so nothing in it decides what gitleaks reports: the mirror is bare (a
 * `.gitleaks.toml` the change brings is not on disk), the ignore file is looked for in an empty
 * directory, and `gitleaks:allow` comments are not honoured. Secrets are redacted in its report.
 */
export class GitleaksScanner implements SecretScanner {
  constructor(
    private readonly options: { readonly mirrors: GitMirrors; readonly command: string },
  ) {}

  async scan(
    repository: RepositoryRef,
    baseSha: string,
    change: ChangeRef,
  ): Promise<Publishing<readonly SecretFinding[]>> {
    const imported = await this.options.mirrors.importChange(repository, baseSha, change);
    if (!imported.ok) return imported;
    const scratch = await mkdtemp(path.join(tmpdir(), 'redline-gitleaks-'));
    const report = path.join(scratch, 'report.json');
    try {
      await run(
        this.options.command,
        [
          'git',
          this.options.mirrors.mirrorOf(repository),
          `--log-opts=${baseSha}..${imported.value}`,
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
