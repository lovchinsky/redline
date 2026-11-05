import * as z from 'zod/mini';

export const ruleSourceSchema = z.discriminatedUnion('kind', [
  /** A file the dev server names, e.g. Vite's `data-vite-dev-id`: the best pointer to code. */
  z.readonly(z.object({ kind: z.literal('dev-module'), path: z.string() })),
  /** A linked stylesheet, by URL path. */
  z.readonly(z.object({ kind: z.literal('stylesheet'), path: z.string() })),
  z.readonly(z.object({ kind: z.literal('inline-style-element') })),
  /** Constructed stylesheets (`adoptedStyleSheets`), as CSS-in-JS and web components use. */
  z.readonly(z.object({ kind: z.literal('constructed') })),
  z.readonly(z.object({ kind: z.literal('style-attribute') })),
]);
export type RuleSource = z.infer<typeof ruleSourceSchema>;

export const matchedRuleSchema = z.readonly(
  z.object({
    /** The selectors of the rule that match the element. */
    selector: z.string(),
    declarations: z.string(),
    source: ruleSourceSchema,
    /** Conditions the rule sits under (`@media …`, `@supports …`, `@layer …`). */
    conditions: z.readonly(z.array(z.string())),
  }),
);
export type MatchedRule = z.infer<typeof matchedRuleSchema>;

export const cssRulesSchema = z.object({
  elements: z.readonly(
    z.array(
      z.readonly(
        z.object({
          label: z.string(),
          /** Weakest first: by specificity, then order of appearance; layers and `!important` not weighed. */
          rules: z.readonly(z.array(matchedRuleSchema)),
        }),
      ),
    ),
  ),
  /** Cross-origin stylesheets, whose rules the browser does not let anyone read. */
  unreadableSheets: z.int().check(z.nonnegative()),
});
export type CssRulesData = z.infer<typeof cssRulesSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'css-rules': CssRulesData;
  }
}
