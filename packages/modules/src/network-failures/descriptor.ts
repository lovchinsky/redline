import { defineFragment, md } from '@redline/core';
import { networkFailuresSchema } from './types';

export const networkFailuresFragment = defineFragment({
  kind: 'network-failures',
  title: 'Failed requests',
  version: 1,
  schema: networkFailuresSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => [
      {
        section: 'runtime',
        markdown: [
          '**Failed requests** (newest first):',
          '',
          ...data.requests.map((request) => {
            const status = request.status === 0 ? 'no response' : String(request.status);
            const repeated = request.count > 1 ? ` ×${String(request.count)}` : '';
            return `- ${status} ${md.code(request.url)} (${request.initiator})${repeated}, ${String(request.secondsAgo)} s ago`;
          }),
        ].join('\n'),
      },
    ],
  },
});
