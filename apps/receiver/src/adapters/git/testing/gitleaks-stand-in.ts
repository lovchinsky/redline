import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * gitleaks as the receiver calls it, standing in for the binary: it keeps its arguments and
 * writes the report the test gave it. What gitleaks itself finds is the integration test's
 * (`gitleaks.integration.test.ts`).
 */
const STAND_IN = `#!/bin/sh
here="$(dirname "$0")"
printf '%s\\n' "$@" > "$here/arguments"
for arg in "$@"; do
  case "$arg" in
    --report-path=*) report="\${arg#--report-path=}" ;;
  esac
done
cp "$here/report.json" "$report"
`;

/** A finding as gitleaks reports it, its secret redacted. */
export interface ReportedFinding {
  readonly File: string;
  readonly StartLine: number;
  readonly RuleID: string;
}

/**
 * Writes the stand-in as `gitleaks` in `dir`. It reports nothing until `report` says what it
 * finds; its arguments are kept in `dir/arguments`.
 */
export const gitleaksStandIn = async (dir: string) => {
  const command = path.join(dir, 'gitleaks');
  await writeFile(command, STAND_IN);
  await chmod(command, 0o755);
  const report = (findings: readonly ReportedFinding[]) =>
    writeFile(
      path.join(dir, 'report.json'),
      JSON.stringify(findings.map((finding) => ({ ...finding, Secret: 'REDACTED' }))),
    );
  await report([]);
  return { command, report };
};
