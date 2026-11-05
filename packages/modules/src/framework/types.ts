import * as z from 'zod/mini';

export const frameworkSchema = z.object({
  framework: z.enum(['react', 'vue', 'svelte', 'angular']),
  version: z.nullable(z.string()),
  mode: z.enum(['development', 'production', 'unknown']),
  element: z.string(),
  /** Innermost first; `file` is relative to the project when the build records it. */
  components: z.readonly(
    z.array(
      z.readonly(
        z.object({
          name: z.string(),
          file: z.nullable(z.string()),
          line: z.nullable(z.int()),
        }),
      ),
    ),
  ),
});
export type FrameworkData = z.infer<typeof frameworkSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    framework: FrameworkData;
  }
}
