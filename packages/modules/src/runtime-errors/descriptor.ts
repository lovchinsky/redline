import { defineFragment, md } from '@redline/core';
import { runtimeErrorsSchema } from './types';

const observedSinceText = (since: 'page-load' | 'capture-start'): string =>
  since === 'page-load' ? 'since the page loaded' : 'since capture started';

export const runtimeErrorsFragment = defineFragment({
  kind: 'runtime-errors',
  title: 'Runtime errors',
  version: 1,
  schema: runtimeErrorsSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => [
      {
        section: 'runtime',
        markdown: [
          `**Runtime errors** (${observedSinceText(data.observedSince)}, newest first):`,
          '',
          ...data.errors.map((error) => {
            const repeated = error.count > 1 ? ` ×${String(error.count)}` : '';
            const source = error.source === null ? '' : ` at ${md.code(error.source)}`;
            return `- ${md.code(md.truncate(error.message, 200))}${source}${repeated}, ${String(error.secondsAgo)} s ago`;
          }),
        ].join('\n'),
      },
    ],
  },
});
