import * as z from 'zod/mini';

export const pageMetaSchema = z.object({
  url: z.string(),
  routePattern: z.string(),
  title: z.string(),
  viewport: z.object({ width: z.number(), height: z.number() }),
  devicePixelRatio: z.number(),
  colorScheme: z.enum(['light', 'dark']),
  language: z.nullable(z.string()),
  /** How the page is served; a dev server usually means source paths are recoverable. */
  environment: z.enum(['dev-server', 'local', 'deployed']),
});
export type PageMetaData = z.infer<typeof pageMetaSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'page-meta': PageMetaData;
  }
}
