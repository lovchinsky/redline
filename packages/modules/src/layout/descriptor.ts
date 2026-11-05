import { defineFragment, md } from '@redline/core';
import { layoutSchema } from './types';

const round = (value: number) => String(Math.round(value));

export const layoutFragment = defineFragment({
  kind: 'layout',
  version: 1,
  schema: layoutSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const styles = Object.entries(data.styles)
        .map(([property, value]) => `${property}: ${value}`)
        .join('; ');
      const lines = [`**Layout of ${md.code(data.container)}:** ${md.code(styles)}`];
      if (data.children.length > 0) {
        lines.push(
          '',
          md.table(
            ['#', 'Child', 'Box (x, y, w×h)', 'Circled'],
            data.children.map((child, index) => [
              String(index + 1),
              md.code(child.label),
              `${round(child.box.x)}, ${round(child.box.y)}, ${round(child.box.width)}×${round(child.box.height)}`,
              child.circled ? 'yes' : '',
            ]),
          ),
        );
        if (data.childCount > data.children.length) {
          lines.push('', `…and ${String(data.childCount - data.children.length)} more children.`);
        }
      }
      if (data.activeMediaQueries.length > 0) {
        lines.push(
          '',
          `**Active media queries:** ${data.activeMediaQueries.map(md.code).join(', ')}`,
        );
      }
      return [{ section: 'layout', markdown: lines.join('\n') }];
    },
  },
});
