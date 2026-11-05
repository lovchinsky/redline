import { defineFragment, md } from '@redline/core';
import { cssRulesSchema, type RuleSource } from './types';

const sourceLabel = (source: RuleSource): string => {
  switch (source.kind) {
    case 'dev-module':
    case 'stylesheet':
      return md.code(source.path);
    case 'inline-style-element':
      return '`<style>` in the page';
    case 'constructed':
      return 'constructed stylesheet (CSS-in-JS or a web component)';
    case 'style-attribute':
      return 'inline `style` attribute';
  }
};

export const cssRulesFragment = defineFragment({
  kind: 'css-rules',
  title: 'CSS rules',
  version: 1,
  schema: cssRulesSchema,
  migrations: [],
  presenter: {
    summarize: ({ data }) => {
      const lines: string[] = [];
      for (const element of data.elements) {
        if (element.rules.length === 0) continue;
        lines.push(
          `**CSS rules for ${md.code(element.label)}** (weakest first, by specificity and then order; \`@layer\` and \`!important\` not weighed):`,
          '',
          ...element.rules.map((rule) => {
            const conditions =
              rule.conditions.length === 0
                ? ''
                : ` inside ${rule.conditions.map(md.code).join(' ')}`;
            return `- ${md.code(rule.selector)}${conditions} — ${sourceLabel(rule.source)}: ${md.code(rule.declarations)}`;
          }),
          '',
        );
      }
      if (data.unreadableSheets > 0) {
        lines.push(
          `_${String(data.unreadableSheets)} cross-origin stylesheet(s) could not be read._`,
        );
      }
      const markdown = lines.join('\n').trim();
      return markdown === '' ? [] : [{ section: 'styles', markdown }];
    },
  },
});
