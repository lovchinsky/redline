/**
 * Package-level safety net next to the ESLint boundary rules:
 * cycles, undeclared or unresolvable dependencies, and packages reaching into apps.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make initialization order and layering ambiguous.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve; a workspace package must be declared to be resolvable.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: 'Third-party modules must be declared in the package.json of the importing package.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: 'Shared packages are reusable and must not know about any app.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Production code must not import tests.',
      from: { pathNot: '\\.test\\.tsx?$' },
      to: { path: '\\.test\\.tsx?$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Production code must not import devDependencies. WXT is the exception: its runtime helpers are bundled.',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.test\\.tsx?$' },
      to: { dependencyTypes: ['npm-dev'], pathNot: 'node_modules/wxt/' },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Unreferenced modules are dead code.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)vitest\\.config\\.ts$',
          '\\.test\\.tsx?$',
          '/entrypoints/',
          '(^|/)testing/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(\\.output|\\.wxt|node_modules)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      mainFields: ['module', 'main', 'types'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
