import { defineFragment, md } from '@redline/core';
import { anchorsSchema, type Anchor } from './types';

const describe = (anchor: Anchor): string => {
  switch (anchor.kind) {
    case 'text':
      return `text ${md.code(anchor.value)}`;
    case 'custom-tag':
      return `tag ${md.code(`<${anchor.value}>`)}`;
    case 'class':
      return `class ${md.code(anchor.value)}`;
    default:
      return md.code(`${anchor.attribute ?? anchor.kind}="${anchor.value}"`);
  }
};

export const anchorsFragment = defineFragment({
  kind: 'anchors',
  version: 1,
  schema: anchorsSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => [
      {
        section: 'anchors',
        markdown: [
          '**Anchors** (strings likely present in the source code, best first):',
          '',
          ...data.anchors.map((anchor) => `- ${describe(anchor)} on ${md.code(anchor.element)}`),
        ].join('\n'),
      },
    ],
  },
});
