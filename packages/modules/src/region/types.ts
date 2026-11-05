import * as z from 'zod/mini';

export const regionSchema = z.object({
  kind: z.enum(['elements', 'within-element', 'empty-space']),
  groups: z.readonly(
    z.array(z.readonly(z.object({ label: z.string(), count: z.int().check(z.positive()) }))),
  ),
  container: z.string(),
  neighbors: z.readonly(z.array(z.string())),
});
export type RegionData = z.infer<typeof regionSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    region: RegionData;
  }
}
