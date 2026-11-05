import * as z from 'zod/mini';

export const runtimeErrorsSchema = z.object({
  observedSince: z.enum(['page-load', 'capture-start']),
  errors: z.readonly(
    z.array(
      z.readonly(
        z.object({
          message: z.string(),
          source: z.nullable(z.string()),
          count: z.int().check(z.positive()),
          secondsAgo: z.int().check(z.nonnegative()),
        }),
      ),
    ),
  ),
});
export type RuntimeErrorsData = z.infer<typeof runtimeErrorsSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'runtime-errors': RuntimeErrorsData;
  }
}
