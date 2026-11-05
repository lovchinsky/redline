import * as z from 'zod/mini';

export const STYLE_GROUPS = ['box', 'typography', 'visual', 'position'] as const;
export type StyleGroup = (typeof STYLE_GROUPS)[number];

export const computedStylesSchema = z.object({
  elements: z.readonly(
    z.array(
      z.readonly(
        z.object({
          label: z.string(),
          /** Values that differ from the initial value and from what the parent passes down. */
          styles: z.readonly(z.record(z.string(), z.string())),
        }),
      ),
    ),
  ),
});
export type ComputedStylesData = z.infer<typeof computedStylesSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'computed-styles': ComputedStylesData;
  }
}
