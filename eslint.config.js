// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Architectural elements. Each element may only depend on the elements listed in
 * `dependencyPolicies`; everything else is a lint error. Elements for later phases are
 * declared up front so their rules exist before their code does.
 */
const elements = [
  { type: 'core', pattern: 'packages/core' },
  { type: 'contract', pattern: 'packages/contract' },
  { type: 'geometry', pattern: 'packages/geometry' },
  { type: 'dom', pattern: 'packages/dom' },
  { type: 'context-module', pattern: 'packages/modules/src/*', capture: ['moduleName'] },
  { type: 'module-catalog', pattern: 'packages/modules/src' },
  { type: 'capture', pattern: 'packages/capture' },
  { type: 'processor', pattern: 'packages/processors' },
  { type: 'assembly', pattern: 'packages/assembly' },
  { type: 'profiles', pattern: 'packages/profiles' },
  { type: 'pipeline', pattern: 'packages/pipeline' },
  { type: 'page-runtime', pattern: 'packages/page-runtime' },
  { type: 'rpc', pattern: 'packages/rpc' },
  { type: 'ext-entrypoint', pattern: 'apps/extension/src/entrypoints' },
  { type: 'ext-composition', pattern: 'apps/extension/src/composition' },
  { type: 'ext-ports', pattern: 'apps/extension/src/ports' },
  { type: 'ext-application', pattern: 'apps/extension/src/application' },
  { type: 'ext-adapter', pattern: 'apps/extension/src/adapters' },
  { type: 'ext-ui', pattern: 'apps/extension/src/ui' },
  // The receiver: a separate deployable that shares only the contract with the extension.
  { type: 'agent-protocol', pattern: 'packages/agent-protocol' },
  { type: 'path-patterns', pattern: 'packages/path-patterns' },
  { type: 'rcv-domain', pattern: 'apps/receiver/src/domain' },
  { type: 'rcv-ports', pattern: 'apps/receiver/src/ports' },
  { type: 'rcv-application', pattern: 'apps/receiver/src/application' },
  {
    type: 'rcv-adapter',
    pattern: 'apps/receiver/src/adapters/*',
    capture: ['adapterName'],
  },
  { type: 'rcv-composition', pattern: 'apps/receiver/src/composition' },
  { type: 'rcv-entrypoint', pattern: 'apps/receiver/src/entrypoints' },
  // agent-host: the program inside a run's sandbox, layered like the receiver.
  { type: 'ah-domain', pattern: 'apps/agent-host/src/domain' },
  { type: 'ah-ports', pattern: 'apps/agent-host/src/ports' },
  { type: 'ah-application', pattern: 'apps/agent-host/src/application' },
  { type: 'ah-adapter', pattern: 'apps/agent-host/src/adapters/*', capture: ['adapterName'] },
  { type: 'ah-composition', pattern: 'apps/agent-host/src/composition' },
  { type: 'ah-entrypoint', pattern: 'apps/agent-host/src/entrypoints' },
];

/** @param {string[]} types */
const to = (types) => ({ to: { element: { types: { anyOf: types } } } });

const dependencyPolicies = [
  { from: { element: { type: 'core' } }, allow: to(['core']) },
  { from: { element: { type: 'contract' } }, allow: to(['contract']) },
  { from: { element: { type: 'geometry' } }, allow: to(['geometry']) },
  { from: { element: { type: 'dom' } }, allow: to(['dom', 'core', 'geometry']) },
  {
    // A context module may use its own files, but never another module.
    from: { element: { type: 'context-module' } },
    allow: [
      to(['core', 'geometry', 'dom', 'capture']),
      {
        to: {
          element: {
            type: 'context-module',
            captured: { moduleName: '{{from.captured.moduleName}}' },
          },
        },
      },
    ],
  },
  // The catalogs only list modules; modules never import each other.
  {
    from: { element: { type: 'module-catalog' } },
    allow: to(['context-module', 'core', 'capture']),
  },
  { from: { element: { type: 'capture' } }, allow: to(['capture', 'core', 'dom', 'geometry']) },
  { from: { element: { type: 'processor' } }, allow: to(['processor', 'core']) },
  { from: { element: { type: 'assembly' } }, allow: to(['assembly', 'core', 'contract']) },
  { from: { element: { type: 'profiles' } }, allow: to(['profiles', 'capture']) },
  // The shipped capture: modules, processors and profile put together, once, for every caller.
  {
    from: { element: { type: 'pipeline' } },
    allow: to(['pipeline', 'capture', 'core', 'module-catalog', 'processor', 'profiles']),
  },
  { from: { element: { type: 'page-runtime' } }, allow: to(['page-runtime']) },
  { from: { element: { type: 'rpc' } }, allow: to(['rpc', 'core']) },
  // Ports are the application's contracts with the platform: adapters implement them.
  {
    from: { element: { type: 'ext-ports' } },
    allow: to(['ext-ports', 'core', 'rpc', 'capture', 'assembly']),
  },
  {
    from: { element: { type: 'ext-application' } },
    allow: to(['ext-application', 'ext-ports', 'core', 'rpc', 'contract', 'capture', 'assembly']),
  },
  {
    from: { element: { type: 'ext-adapter' } },
    allow: to([
      'ext-adapter',
      'ext-ports',
      'core',
      'rpc',
      'contract',
      'capture',
      'assembly',
      'geometry',
      'dom',
      'page-runtime',
    ]),
  },
  {
    from: { element: { type: 'ext-ui' } },
    allow: to(['ext-ui', 'ext-ports', 'core', 'rpc', 'geometry', 'dom', 'capture']),
  },
  {
    from: { element: { type: 'ext-composition' } },
    allow: to(elements.map((element) => element.type).filter((type) => type !== 'ext-entrypoint')),
  },
  { from: { element: { type: 'ext-entrypoint' } }, allow: to(['ext-composition', 'ext-ui']) },
  // The agent's exchange format with the receiver: data schemas only.
  { from: { element: { type: 'agent-protocol' } }, allow: to(['agent-protocol']) },
  { from: { element: { type: 'path-patterns' } }, allow: to(['path-patterns']) },
  // The domain knows nothing outside itself: no contract, no storage, no agent, no git host.
  // Path globs are shared with agent-host, so both read a protected path the same way.
  { from: { element: { type: 'rcv-domain' } }, allow: to(['rcv-domain', 'path-patterns']) },
  { from: { element: { type: 'rcv-ports' } }, allow: to(['rcv-ports', 'rcv-domain']) },
  {
    from: { element: { type: 'rcv-application' } },
    allow: to(['rcv-application', 'rcv-ports', 'rcv-domain']),
  },
  {
    // An adapter may use its own files and the ones it builds on; only the Claude runner and
    // the gateway speak the agent's exchange format.
    from: { element: { type: 'rcv-adapter' } },
    allow: [
      to(['rcv-ports', 'rcv-domain', 'contract']),
      {
        to: {
          element: {
            type: 'rcv-adapter',
            captured: { adapterName: '{{from.captured.adapterName}}' },
          },
        },
      },
      { to: { element: { type: 'rcv-adapter', captured: { adapterName: 'shared' } } } },
    ],
  },
  {
    from: { element: { type: 'rcv-adapter', captured: { adapterName: 'runner-claude' } } },
    allow: to(['agent-protocol']),
  },
  {
    from: { element: { type: 'rcv-adapter', captured: { adapterName: 'gateway' } } },
    allow: to(['agent-protocol']),
  },
  {
    from: { element: { type: 'rcv-composition' } },
    allow: to([
      'rcv-composition',
      'rcv-adapter',
      'rcv-application',
      'rcv-ports',
      'rcv-domain',
      'contract',
    ]),
  },
  { from: { element: { type: 'rcv-entrypoint' } }, allow: to(['rcv-composition']) },
  // agent-host executes the agent protocol: its brief and outcome are its model, at every layer.
  {
    from: { element: { type: 'ah-domain' } },
    allow: to(['ah-domain', 'agent-protocol', 'path-patterns']),
  },
  {
    from: { element: { type: 'ah-ports' } },
    allow: to(['ah-ports', 'ah-domain', 'agent-protocol']),
  },
  {
    from: { element: { type: 'ah-application' } },
    allow: to(['ah-application', 'ah-ports', 'ah-domain', 'agent-protocol']),
  },
  {
    from: { element: { type: 'ah-adapter' } },
    allow: [
      to(['ah-ports', 'ah-domain', 'agent-protocol']),
      {
        to: {
          element: {
            type: 'ah-adapter',
            captured: { adapterName: '{{from.captured.adapterName}}' },
          },
        },
      },
    ],
  },
  {
    from: { element: { type: 'ah-composition' } },
    allow: to([
      'ah-composition',
      'ah-adapter',
      'ah-application',
      'ah-ports',
      'ah-domain',
      'agent-protocol',
    ]),
  },
  { from: { element: { type: 'ah-entrypoint' } }, allow: to(['ah-composition']) },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
      '**/dist/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // Stand-ins for users' projects: the anchor evaluation reads them, our rules do not apply.
      'tools/eval/corpus/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        // Single-run mode builds a Program per tsconfig beside the project service's, and
        // with this workspace's many tsconfigs the lint runs out of memory (typescript-eslint
        // issue 13109). The project service alone serves every file.
        disallowAutomaticSingleRunInference: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: false }],
    },
  },
  {
    files: [
      'packages/**/*.{ts,tsx}',
      'apps/extension/src/**/*.{ts,tsx}',
      'apps/receiver/src/**/*.ts',
      'apps/agent-host/src/**/*.ts',
    ],
    // Tests and tool configuration are not part of the architecture.
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/vitest.config.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'import/resolver': { typescript: true },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: dependencyPolicies }],
      'boundaries/no-unknown-files': 'error',
    },
  },
  {
    // Shared packages are platform-agnostic: browser APIs only enter through ports and adapters.
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message: 'Use a port; extension APIs live in apps/extension/src/adapters.',
        },
        {
          name: 'browser',
          message: 'Use a port; extension APIs live in apps/extension/src/adapters.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['wxt', 'wxt/*', '#imports', 'webextension-polyfill', '@wxt-dev/*'],
              message: 'Shared packages must not depend on the extension framework.',
            },
          ],
        },
      ],
    },
  },
  {
    // Only adapters and composition roots may talk to extension APIs.
    files: ['apps/extension/src/{application,ports,ui}/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['wxt/browser', '#imports', 'idb'],
              message: 'Platform APIs belong in adapters; receive them through ports.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', { name: 'chrome', message: 'Use a port.' }],
    },
  },
  {
    // The receiver's and agent-host's cores decide; adapters do I/O. Their domain, ports and use
    // cases reach the platform, storage, network, agent and git host only through ports.
    files: [
      'apps/receiver/src/{domain,ports,application}/**/*.ts',
      'apps/agent-host/src/{domain,ports,application}/**/*.ts',
    ],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'crypto',
                'child_process',
                'pg',
                'pg-boss',
                'kysely',
                'fastify',
                '@fastify/*',
                'yaml',
                'pino',
                '@anthropic-ai/*',
                '@octokit/*',
                'zod',
                'zod/*',
              ],
              message:
                'Platform, storage and network belong in adapters; receive them through ports.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Configuration arrives through the composition root.' },
        { name: 'fetch', message: 'Network access belongs in adapters.' },
        { name: 'setTimeout', message: 'Time comes from the Clock port; scheduling from jobs.' },
        { name: 'Date', message: 'Time comes from the Clock port.' },
      ],
    },
  },
  {
    // Preact hooks follow React's rules: stale effect dependencies are how UI races start.
    files: ['apps/extension/src/ui/**/*.tsx', 'apps/extension/src/ui/**/*.ts'],
    // Its rules alone: the two below are the ones used, none of its preset configurations.
    plugins: { 'react-hooks': { meta: reactHooks.meta, rules: reactHooks.rules } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/extension/e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
