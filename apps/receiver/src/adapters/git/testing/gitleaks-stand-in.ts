import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * gitleaks as the scanner calls it, standing in for the binary: it reports every added line
 * with `AKIA` in the commit range it is given, and keeps its arguments.
 */
const STAND_IN = `#!/bin/sh
printf '%s\\n' "$@" > "$(dirname "$0")/arguments"
for arg in "$@"; do
  case "$arg" in
    --log-opts=*) range="\${arg#--log-opts=}" ;;
    --report-path=*) report="\${arg#--report-path=}" ;;
  esac
done
repo="$2"
found=$(git -C "$repo" log -p "$range" | grep -c '^+.*AKIA')
if [ "$found" -gt 0 ]; then
  echo '[{"File":"config.js","StartLine":1,"RuleID":"aws-access-token","Secret":"REDACTED"}]' > "$report"
else
  echo '[]' > "$report"
fi
`;

/** Writes the stand-in as `gitleaks` in `dir`, keeping its arguments in `dir/arguments`. */
export const gitleaksStandIn = async (dir: string): Promise<string> => {
  const command = path.join(dir, 'gitleaks');
  await writeFile(command, STAND_IN);
  await chmod(command, 0o755);
  return command;
};
