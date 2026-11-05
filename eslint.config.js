// @ts-check
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
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
  { type: 'page-runtime', pattern: 'packages/page-runtime' },
  { type: 'rpc', pattern: 'packages/rpc' },
  { type: 'ext-entrypoint', pattern: 'apps/extension/src/entrypoints' },
  { type: 'ext-composition', pattern: 'apps/extension/src/composition' },
  { type: 'ext-ports', pattern: 'apps/extension/src/ports' },
  { type: 'ext-application', pattern: 'apps/extension/src/application' },
  { type: 'ext-adapter', pattern: 'apps/extension/src/adapters' },
  { type: 'ext-ui', pattern: 'apps/extension/src/ui' },
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
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/.output/**',
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
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: false }],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/extension/src/**/*.{ts,tsx}'],
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
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/extension/e2e/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
);
