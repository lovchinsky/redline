import { defineFragment, md } from '@redline/core';
import { frameworkSchema } from './types';

const FRAMEWORK_NAMES = {
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  angular: 'Angular',
} as const;

export const frameworkFragment = defineFragment({
  kind: 'framework',
  title: 'Components',
  version: 1,
  schema: frameworkSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const framework = [
        FRAMEWORK_NAMES[data.framework],
        data.version === null ? null : md.escapeText(data.version),
        data.mode === 'unknown' ? null : `${data.mode} build`,
      ]
        .filter((part) => part !== null)
        .join(' ');
      const components = data.components.map((component) => {
        const location =
          component.file === null
            ? ''
            : ` (${md.code(component.line === null ? component.file : `${component.file}:${String(component.line)}`)})`;
        return `${md.code(component.name)}${location}`;
      });
      return [
        {
          section: 'anchors',
          markdown: `**Components** rendering ${md.code(data.element)} (${framework}), innermost first: ${components.join(' ‹ ')}`,
        },
      ];
    },
  },
});
