/** Pieces several features' requests share. */
import { ProjectId, StepId, TaskId } from '@redline/core';
import * as z from 'zod/mini';

export const empty = z.object({});

export const taskRef = z.object({ taskId: TaskId });

export const stepRef = z.object({ taskId: TaskId, stepId: StepId });

export const projectSchema = z.object({ id: ProjectId, name: z.string().check(z.minLength(1)) });

export type ProjectRef = z.infer<typeof projectSchema>;

/**
 * A frozen bundle as the UI reads it: what is in it, and the digest its files are read by. The
 * same content is what gets, or got, delivered.
 */
export const frozenBundleSchema = z.object({
  taskId: TaskId,
  /** Content hash of the frozen bundle. */
  digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  entry: z.string(),
  files: z.readonly(
    z.array(
      z.object({
        path: z.string(),
        mediaType: z.string(),
        bytes: z.int().check(z.nonnegative()),
      }),
    ),
  ),
});

export type FrozenBundle = z.infer<typeof frozenBundleSchema>;
