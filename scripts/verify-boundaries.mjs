// Proves that architectural rules are enforced: each probe below must be rejected by ESLint
// (and the control probe accepted). Fails the build if a rule silently stops working.
//
// Probes are written to real files for the duration of the check, because type-aware
// linting only accepts files that belong to a tsconfig project.
import { ESLint } from 'eslint';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** @typedef {{ name: string, file: string, code: string, expectRule: string | null }} Probe */

/** @type {Probe[]} */
const probes = [
  {
    name: 'core must not depend on rpc (relative import)',
    file: 'packages/core/src/__boundary_probe__.ts',
    code: "import { protocol } from '../../rpc/src/protocol';\nexport const probe = protocol;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'ui must not depend on contract (workspace import)',
    file: 'apps/extension/src/ui/__boundary_probe__.ts',
    code: "import { BUNDLE_ENTRY } from '@redline/contract';\nexport const probe = BUNDLE_ENTRY;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'shared packages must not touch extension globals',
    file: 'packages/rpc/src/__boundary_probe__.ts',
    code: 'export const probe = chrome.runtime.id;\n',
    expectRule: 'no-restricted-globals',
  },
  {
    name: 'shared packages must not import the extension framework',
    file: 'packages/core/src/__boundary_probe__.ts',
    code: "import { browser } from 'wxt/browser';\nexport const probe = browser;\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'ui must not depend on adapters',
    file: 'apps/extension/src/ui/__boundary_probe__.ts',
    code: "import { systemClock } from '../adapters/system/system-clock';\nexport const probe = systemClock;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'application must not use platform APIs directly',
    file: 'apps/extension/src/application/__boundary_probe__.ts',
    code: "import { browser } from 'wxt/browser';\nexport const probe = browser;\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'the shipped capture must not depend on assembly',
    file: 'packages/pipeline/src/__boundary_probe__.ts',
    code: "import { Packager } from '@redline/assembly';\nexport const probe = Packager;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'a context module must not import another module',
    file: 'packages/modules/src/anchors/__boundary_probe__.ts',
    code: "import { layoutCollector } from '../layout/collector';\nexport const probe = layoutCollector;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'the capture engine must not depend on context modules',
    file: 'packages/capture/src/__boundary_probe__.ts',
    code: "import { regionCollector } from '../../modules/src/region/collector';\nexport const probe = regionCollector;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'assembly must not depend on context modules',
    file: 'packages/assembly/src/__boundary_probe__.ts',
    code: "import { screenshotFragment } from '../../modules/src/screenshot/descriptor';\nexport const probe = screenshotFragment;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'processors must not depend on assembly',
    file: 'packages/processors/src/__boundary_probe__.ts',
    code: "import { MORE_CONTEXT_PATH } from '../../assembly/src/composer';\nexport const probe = MORE_CONTEXT_PATH;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'the page runtime (MAIN world) must stay free of other packages',
    file: 'packages/page-runtime/src/__boundary_probe__.ts',
    code: "import { ok } from '../../core/src/shared/result';\nexport const probe = ok(1);\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'the receiver domain must not depend on its ports',
    file: 'apps/receiver/src/domain/__boundary_probe__.ts',
    code: "import type { Clock } from '../ports/system';\nexport type Probe = Clock;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'receiver use cases must not depend on the contract',
    file: 'apps/receiver/src/application/__boundary_probe__.ts',
    code: "import { BUNDLE_ENTRY } from '../../../../packages/contract/src/bundle.v1';\nexport const probe = BUNDLE_ENTRY;\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'receiver use cases must not reach storage directly',
    file: 'apps/receiver/src/application/__boundary_probe__.ts',
    code: "import { readFile } from 'node:fs/promises';\nexport const probe = readFile;\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'the receiver domain must not read the clock itself',
    file: 'apps/receiver/src/domain/__boundary_probe__.ts',
    code: 'export const probe = () => Date.now();\n',
    expectRule: 'no-restricted-globals',
  },
  {
    name: 'the receiver must not depend on the extension’s core',
    file: 'apps/receiver/src/application/__boundary_probe__.ts',
    code: "import { ok } from '../../../../packages/core/src/shared/result';\nexport const probe = ok(1);\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'the extension must not depend on the receiver',
    file: 'apps/extension/src/adapters/__boundary_probe__.ts',
    code: "import { ok } from '../../../receiver/src/domain/result';\nexport const probe = ok(1);\n",
    expectRule: 'boundaries/dependencies',
  },
  {
    name: 'control: receiver use cases may depend on the domain',
    file: 'apps/receiver/src/application/__boundary_probe__.ts',
    code: "import { ok } from '../domain/result';\nexport const probe = ok(1);\n",
    expectRule: null,
  },
  {
    name: 'control: the module catalog may list modules',
    file: 'packages/modules/src/__boundary_probe__.ts',
    code: "import { layoutCollector } from './layout/collector';\nexport const probe = layoutCollector;\n",
    expectRule: null,
  },
  {
    name: 'control: adapters may depend on core',
    file: 'apps/extension/src/adapters/__boundary_probe__.ts',
    code: "import { ok } from '@redline/core';\nexport const probe = ok(1);\n",
    expectRule: null,
  },
];

const eslint = new ESLint({ cwd: root });
const architecturalRules = new Set([
  'boundaries/dependencies',
  'no-restricted-globals',
  'no-restricted-imports',
]);

/** @param {Probe} probe */
const lintProbe = async (probe) => {
  const filePath = path.join(root, probe.file);
  await writeFile(filePath, probe.code);
  try {
    const [result] = await eslint.lintFiles([filePath]);
    return result;
  } finally {
    await rm(filePath, { force: true });
  }
};

let failures = 0;
for (const probe of probes) {
  const result = await lintProbe(probe);
  const fatal = (result?.messages ?? []).find((message) => message.fatal);
  if (fatal !== undefined) {
    console.log(`FAIL ${probe.name} (could not lint: ${fatal.message})`);
    failures += 1;
    continue;
  }
  const fired = (result?.messages ?? [])
    .map((message) => message.ruleId)
    .filter((ruleId) => ruleId !== null && architecturalRules.has(ruleId));
  const passed = probe.expectRule === null ? fired.length === 0 : fired.includes(probe.expectRule);
  console.log(
    `${passed ? 'ok  ' : 'FAIL'} ${probe.name}${passed ? '' : ` (fired: ${fired.join(', ') || 'none'})`}`,
  );
  if (!passed) failures += 1;
}

if (failures > 0) {
  console.error(`\n${String(failures)} architectural rule(s) are not enforced.`);
  process.exit(1);
}
console.log('\nAll architectural rules are enforced.');
