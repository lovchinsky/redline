import { defineFragment, md } from '@redline/core';
import { regionSchema, type RegionData } from './types';

const circled = (data: RegionData): string => {
  switch (data.kind) {
    case 'elements':
      return data.groups
        .map(
          (group) => `${md.code(group.label)}${group.count > 1 ? ` ×${String(group.count)}` : ''}`,
        )
        .join(', ');
    case 'within-element':
      return `part of ${md.code(data.container)}`;
    case 'empty-space':
      return `empty space inside ${md.code(data.container)}`;
  }
};

export const regionFragment = defineFragment({
  kind: 'region',
  title: 'Circled area',
  version: 1,
  schema: regionSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const lines = [`**Circled:** ${circled(data)}`];
      if (data.kind === 'elements') lines.push(`**Container:** ${md.code(data.container)}`);
      if (data.neighbors.length > 0)
        lines.push(`**Next to:** ${data.neighbors.map(md.code).join(', ')}`);
      return [{ section: 'region', markdown: lines.join('  \n') }];
    },
  },
});
