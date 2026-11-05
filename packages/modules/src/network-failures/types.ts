import * as z from 'zod/mini';

/** From the page's Resource Timing buffer, which covers the page since it loaded. */
export const networkFailuresSchema = z.object({
  requests: z.readonly(
    z.array(
      z.readonly(
        z.object({
          /** Without query and fragment. */
          url: z.string(),
          /** 0: failed without a response. */
          status: z.int().check(z.nonnegative()),
          initiator: z.string(),
          count: z.int().check(z.positive()),
          secondsAgo: z.int().check(z.nonnegative()),
        }),
      ),
    ),
  ),
});
export type NetworkFailuresData = z.infer<typeof networkFailuresSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'network-failures': NetworkFailuresData;
  }
}
