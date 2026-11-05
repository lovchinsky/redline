/** Drafts: what the user is still writing, and the bundle it would become. */
import { StepId, TaskId, assetRefSchema, pageRefSchema } from '@redline/core';
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';
import { empty, taskRef, stepRef } from './shared';

export const draftSummarySchema = z.object({
  id: TaskId,
  /** The user's title; `null` when the UI should derive one from the steps. */
  title: z.nullable(z.string()),
  /** Comment of the first step, a fallback title. */
  firstComment: z.nullable(z.string()),
  stepCount: z.int().check(z.nonnegative()),
  updatedAt: z.number(),
});

export type DraftSummary = z.infer<typeof draftSummarySchema>;

export const stepViewSchema = z.object({
  id: StepId,
  comment: z.string(),
  page: pageRefSchema,
  areaCount: z.int().check(z.positive()),
  capturedAt: z.number(),
  /** Image of the first circled area, read by the UI straight from the asset store. */
  thumbnail: z.nullable(assetRefSchema),
});

export type StepView = z.infer<typeof stepViewSchema>;

export const draftViewSchema = z.object({
  id: TaskId,
  title: z.nullable(z.string()),
  revision: z.int().check(z.nonnegative()),
  updatedAt: z.number(),
  steps: z.readonly(z.array(stepViewSchema)),
});

export type DraftView = z.infer<typeof draftViewSchema>;

export const bundlePreviewSchema = z.object({
  taskId: TaskId,
  revision: z.int().check(z.nonnegative()),
  /** Content hash of the frozen bundle; exactly this content is what gets delivered. */
  digest: z.string().check(z.regex(/^[a-f0-9]{64}$/)),
  createdAt: z.string(),
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
  warnings: z.readonly(z.array(z.string())),
});

export type BundlePreview = z.infer<typeof bundlePreviewSchema>;

export const draftMethods = defineProtocol({
  /** Drafts, most recently changed first, and the one new steps go to. */
  'drafts.list': {
    request: empty,
    response: z.object({
      activeId: z.nullable(TaskId),
      drafts: z.readonly(z.array(draftSummarySchema)),
    }),
    callers: ['extension'],
  },
  'drafts.get': { request: taskRef, response: draftViewSchema, callers: ['extension'] },
  /** Creates an empty draft and makes it active. */
  'drafts.create': { request: empty, response: taskRef, callers: ['extension'] },
  /** Makes a draft the one new steps go to. */
  'drafts.activate': { request: taskRef, response: empty, callers: ['extension'] },
  'drafts.rename': {
    request: z.object({ taskId: TaskId, title: z.string() }),
    response: empty,
    callers: ['extension'],
  },

  'steps.editComment': {
    request: z.object({
      taskId: TaskId,
      stepId: StepId,
      comment: z.string(),
    }),
    response: empty,
    callers: ['extension'],
  },
  'steps.move': {
    request: z.object({ taskId: TaskId, stepId: StepId, toIndex: z.int().check(z.nonnegative()) }),
    response: empty,
    callers: ['extension'],
  },
  'steps.remove': { request: stepRef, response: empty, callers: ['extension'] },
  /** Deletes a draft with the context collected for it. */
  'drafts.delete': { request: taskRef, response: empty, callers: ['extension'] },
  /**
   * Assembles the draft into a frozen bundle and describes it. The same bundle is delivered
   * later, so the preview shows exactly what will be sent.
   */
  'drafts.assemble': { request: taskRef, response: bundlePreviewSchema, callers: ['extension'] },
});
