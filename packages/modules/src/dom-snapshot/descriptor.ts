import { defineFragment, md, type DetailFile } from '@redline/core';
import { domSnapshotSchema, type DomSnapshotData } from './types';

const detailFile = (data: DomSnapshotData): DetailFile => ({
  name: 'dom',
  extension: 'html',
  mediaType: 'text/html',
  content: data.html,
});

export const domSnapshotFragment = defineFragment({
  kind: 'dom-snapshot',
  title: 'DOM snapshot',
  version: 1,
  schema: domSnapshotSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }, context) => {
      const path = context.detailPath(detailFile(data));
      return [
        {
          section: 'details',
          markdown: `**DOM of ${md.code(data.root)}:** [${path}](${path})${data.truncated ? ' (truncated)' : ''} — circled elements carry \`data-redline="selected"\`.`,
        },
      ];
    },
  },
});
