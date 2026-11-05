// Proves that the dependency-cruiser rules are enforced: each probe below must be reported
// under its rule (and the control probe not at all). Fails the build if a rule silently stops
// working, e.g. after a path in the configuration changes.
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const run = promisify(execFile);

/** @typedef {{ name: string, files: Record<string, string>, entry: string, expectRule: string | null }} Probe */

/** @type {Probe[]} */
const probes = [
  {
    name: 'circular imports',
    files: {
      'packages/core/src/__cruise_probe__/a.ts': "import { b } from './b';\nexport const a = b;\n",
      'packages/core/src/__cruise_probe__/b.ts': "import { a } from './a';\nexport const b = a;\n",
    },
    entry: 'packages/core/src/__cruise_probe__',
    expectRule: 'no-circular',
  },
  {
    name: 'a shared package reaching into an app',
    files: {
      'packages/core/src/__cruise_probe__/app.ts':
        "export type { TaskRepository } from '../../../../apps/extension/src/ports/drafts';\n",
    },
    entry: 'packages/core/src/__cruise_probe__',
    expectRule: 'packages-not-to-apps',
  },
  {
    name: 'production code importing a test',
    files: {
      'packages/core/src/__cruise_probe__/test.ts': "export * from '../shared/result.test';\n",
    },
    entry: 'packages/core/src/__cruise_probe__',
    expectRule: 'not-to-test',
  },
  {
    name: 'an import nothing resolves',
    files: {
      'packages/core/src/__cruise_probe__/missing.ts': "export * from './does-not-exist';\n",
    },
    entry: 'packages/core/src/__cruise_probe__',
    expectRule: 'not-to-unresolvable',
  },
  {
    name: 'control: a package importing its own code',
    files: {
      'packages/core/src/__cruise_probe__/ok.ts': "export { ok } from '../shared/result';\n",
    },
    entry: 'packages/core/src/__cruise_probe__',
    expectRule: null,
  },
];

/** @param {Probe} probe @returns {Promise<string[]>} rules reported for the probe's files */
const rulesFor = async (probe) => {
  for (const [file, code] of Object.entries(probe.files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), code);
  }
  try {
    const result = await run(
      path.join(root, 'node_modules/.bin/depcruise'),
      [probe.entry, '--config', '.dependency-cruiser.cjs', '--output-type', 'json'],
      { cwd: root, maxBuffer: 64 * 1024 * 1024 },
    ).catch((/** @type {{ stdout: string }} */ failure) => failure);
    /** @type {{ summary: { violations: { rule: { name: string }, from: string }[] } }} */
    const report = JSON.parse(result.stdout);
    const probeFiles = new Set(Object.keys(probe.files));
    return report.summary.violations
      .filter((violation) => probeFiles.has(violation.from))
      .map((violation) => violation.rule.name);
  } finally {
    await rm(path.join(root, probe.entry), { recursive: true, force: true });
  }
};

let failed = false;
for (const probe of probes) {
  const rules = await rulesFor(probe);
  const ok = probe.expectRule === null ? rules.length === 0 : rules.includes(probe.expectRule);
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${probe.name}${ok ? '' : ` (reported: ${rules.join(', ') || 'nothing'})`}`,
  );
  failed ||= !ok;
}
if (failed) process.exitCode = 1;
