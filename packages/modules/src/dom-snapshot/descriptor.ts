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
  version: 1,
  schema: domSnapshotSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }, context) => [
      {
        section: 'details',
        markdown: `**DOM of ${md.code(data.root)}:** [${context.detailPath(detailFile(data))}](${context.detailPath(detailFile(data))})${data.truncated ? ' (truncated)' : ''} — circled elements carry \`data-redline="selected"\`.`,
      },
    ],
    details: ({ data }) => [detailFile(data)],
  },
});
