// Size budgets of the scripts injected into pages, checked against the production build.
// Usage: node scripts/check-budgets.mjs [build dir], after `pnpm build`.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;

/** What goes into a user's page: every kilobyte is parsed on every capture. */
const BUDGETS = [
  { file: 'content-scripts/capture.js', name: 'content script', gzip: 60 * KB },
  { file: 'page-runtime.js', name: 'page runtime', gzip: 15 * KB },
];

const buildDir = path.resolve(
  process.argv[2] ?? path.join(import.meta.dirname, '../apps/extension/.output/chrome-mv3'),
);

let failed = false;
for (const budget of BUDGETS) {
  const source = await readFile(path.join(buildDir, budget.file));
  const gzip = gzipSync(source, { level: 9 }).length;
  const within = gzip <= budget.gzip;
  failed ||= !within;
  console.log(
    `${within ? 'ok  ' : 'FAIL'} ${budget.name}: ${(gzip / KB).toFixed(1)} KB gzip ` +
      `(budget ${String(budget.gzip / KB)} KB, ${(source.length / KB).toFixed(1)} KB raw)`,
  );
}

if (failed) {
  console.error('A size budget is exceeded.');
  process.exitCode = 1;
}
