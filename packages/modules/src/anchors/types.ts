import * as z from 'zod/mini';

export const ANCHOR_KINDS = [
  'test-id',
  'id',
  'custom-tag',
  'aria-label',
  'name',
  'placeholder',
  'alt',
  'title',
  'text',
  'href',
  'class',
] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

export const anchorSchema = z.object({
  kind: z.enum(ANCHOR_KINDS),
  value: z.string(),
  /** The attribute the value came from, for attribute-based kinds. */
  attribute: z.nullable(z.string()),
  /** Label of the element it was found on. */
  element: z.string(),
  score: z.number(),
});

export const anchorsSchema = z.object({
  anchors: z.readonly(z.array(z.readonly(anchorSchema))),
});
export type Anchor = z.infer<typeof anchorSchema>;
export type AnchorsData = z.infer<typeof anchorsSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    anchors: AnchorsData;
  }
}
