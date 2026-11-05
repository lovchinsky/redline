import * as z from 'zod/mini';

export const layoutChildSchema = z.object({
  label: z.string(),
  /** Box relative to the container's top-left corner, in CSS px. */
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  circled: z.boolean(),
});

export const layoutSchema = z.object({
  container: z.string(),
  /** Layout-relevant computed styles that differ from their initial values. */
  styles: z.readonly(z.record(z.string(), z.string())),
  children: z.readonly(z.array(z.readonly(layoutChildSchema))),
  childCount: z.int().check(z.nonnegative()),
  /** Media query conditions that currently match, from readable stylesheets. */
  activeMediaQueries: z.readonly(z.array(z.string())),
});
export type LayoutData = z.infer<typeof layoutSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    layout: LayoutData;
  }
}
