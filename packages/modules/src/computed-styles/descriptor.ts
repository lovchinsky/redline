import { defineFragment, md } from '@redline/core';
import { computedStylesSchema } from './types';

export const computedStylesFragment = defineFragment({
  kind: 'computed-styles',
  title: 'Computed styles',
  version: 1,
  schema: computedStylesSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const lines = data.elements
        .filter((element) => Object.keys(element.styles).length > 0)
        .map(
          (element) =>
            `- ${md.code(element.label)}: ${md.code(
              Object.entries(element.styles)
                .map(([property, value]) => `${property}: ${value}`)
                .join('; '),
            )}`,
        );
      return lines.length === 0
        ? []
        : [{ section: 'styles', markdown: ['**Computed styles:**', '', ...lines].join('\n') }];
    },
  },
});
