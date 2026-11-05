/** Pieces several features' requests share. */
import { ProjectId, StepId, TaskId } from '@redline/core';
import * as z from 'zod/mini';

export const empty = z.object({});

export const taskRef = z.object({ taskId: TaskId });

export const stepRef = z.object({ taskId: TaskId, stepId: StepId });

export const projectSchema = z.object({ id: ProjectId, name: z.string().check(z.minLength(1)) });

export type ProjectRef = z.infer<typeof projectSchema>;
