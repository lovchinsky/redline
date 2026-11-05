import { defineFragment } from '@redline/core';
import { screenshotSchema } from './types';

const ALT = { crop: 'Circled area', overview: 'Whole viewport with the circled area' } as const;

export const screenshotFragment = defineFragment({
  kind: 'screenshot',
  version: 1,
  schema: screenshotSchema,
  migrations: [],
  presenter: {
    summarize: ({ data, assets }, context) => {
      const lines = data.images.flatMap((image) => {
        const asset = assets.find((candidate) => candidate.id === image.assetId);
        if (asset === undefined) return [];
        const path = context.assetPath(asset, image.role);
        return image.role === 'crop' ? [`![${ALT.crop}](${path})`] : [`[${ALT.overview}](${path})`];
      });
      return lines.length === 0 ? [] : [{ section: 'images', markdown: lines.join('  \n') }];
    },
  },
});
