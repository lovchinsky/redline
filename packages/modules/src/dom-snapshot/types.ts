import * as z from 'zod/mini';

export const domSnapshotSchema = z.object({
  root: z.string(),
  html: z.string(),
  truncated: z.boolean(),
});
export type DomSnapshotData = z.infer<typeof domSnapshotSchema>;

declare module '@redline/core' {
  interface FragmentRegistry {
    'dom-snapshot': DomSnapshotData;
  }
}
