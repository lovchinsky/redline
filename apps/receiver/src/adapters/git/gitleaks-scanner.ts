import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SecretFinding } from '../../domain/change-policy';
import type { ChangeRef } from '../../domain/work';
import type { RepositoryRef } from '../../ports/access';
import type { Publishing, SecretScanner } from '../../ports/publishing';
import type { GitMirrors } from './git-mirrors';

const run = promisify(execFile);

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
 * mirror is bare: a `.gitleaks.toml` or `.gitleaksignore` the change brings is not on disk to
 * be read, so gitleaks judges it by its own rules alone. Secrets are redacted in its report.
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
          '--redact',
          '--no-banner',
          '--exit-code=0',
        ],
        {
          env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: scratch },
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const parsed: unknown = JSON.parse(await readFile(report, 'utf8'));
      if (!Array.isArray(parsed))
        return { ok: false, error: { transient: false, detail: 'gitleaks wrote no report' } };
      return { ok: true, value: parsed.map(findingOf).filter((finding) => finding !== null) };
    } catch (error) {
      return { ok: false, error: { transient: true, detail: `gitleaks failed: ${String(error)}` } };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
