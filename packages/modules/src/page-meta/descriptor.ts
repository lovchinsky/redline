import { defineFragment, md } from '@redline/core';
import { pageMetaSchema } from './types';

const ENVIRONMENT_LABELS = {
  'dev-server': 'dev server',
  local: 'local host',
  deployed: 'deployed',
} as const;

export const pageMetaFragment = defineFragment({
  kind: 'page-meta',
  version: 1,
  schema: pageMetaSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const viewport = `${String(data.viewport.width)}×${String(data.viewport.height)} @${String(data.devicePixelRatio)}x`;
      const facts = [viewport, data.colorScheme, ENVIRONMENT_LABELS[data.environment]];
      if (data.language !== null) facts.push(`lang ${data.language}`);
      return [
        {
          section: 'page',
          markdown: [
            `**Page:** ${md.code(data.routePattern)} — ${md.escapeText(data.title)} (${md.code(data.url)})`,
            `**Viewport:** ${facts.join(' · ')}`,
          ].join('  \n'),
        },
      ];
    },
  },
});
