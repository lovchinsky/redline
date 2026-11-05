import * as z from 'zod/mini';

export const screenshotImageSchema = z.object({
  role: z.enum(['crop', 'overview']),
  assetId: z.string(),
  width: z.int(),
  height: z.int(),
});

export const screenshotSchema = z.object({
  images: z.readonly(z.array(z.readonly(screenshotImageSchema))),
});
export type ScreenshotData = z.infer<typeof screenshotSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    screenshot: ScreenshotData;
  }
}
