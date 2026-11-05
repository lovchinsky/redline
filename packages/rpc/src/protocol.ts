import {
  MAX_COMMENT_LENGTH,
  MAX_TITLE_LENGTH,
  StepId,
  TaskId,
  assetRefSchema,
  intentSchema,
  pageRefSchema,
  stepCaptureEnvelopeSchema,
  viewportSchema,
} from '@redline/core';
import * as z from 'zod/mini';
import { defineEvents, defineProtocol } from './runtime/define';

const pointSchema = z.object({ x: z.number(), y: z.number() });
const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const imageDerivationSchema = z.object({
  source: assetRefSchema,
  area: rectSchema,
  outline: z.readonly(z.array(pointSchema)),
  smoothOutline: z.boolean(),
  masks: z.readonly(z.array(rectSchema)),
  devicePixelRatio: z.number().check(z.positive()),
  format: z.enum(['image/png', 'image/webp']),
  maxSide: z.int().check(z.positive()),
});

export type ImageDerivationRequest = z.infer<typeof imageDerivationSchema>;

const imageSchema = z.object({
  asset: assetRefSchema,
  width: z.int().check(z.nonnegative()),
  height: z.int().check(z.nonnegative()),
});

/** Facts about a step that the domain needs regardless of which fragments were collected. */
export const stepRecordSchema = z.object({
  url: z.url(),
  title: z.string(),
  intent: intentSchema,
  comment: z.string().check(z.minLength(1), z.maxLength(MAX_COMMENT_LENGTH)),
  viewport: viewportSchema,
  shapeIds: z.readonly(z.array(z.string().check(z.minLength(1))).check(z.minLength(1))),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const captureStartResponseSchema = z.object({
  status: z.enum(['started', 'already-active']),
});
export type CaptureStartResponse = z.infer<typeof captureStartResponseSchema>;

const empty = z.object({});
const taskRef = z.object({ taskId: TaskId });
const stepRef = z.object({ taskId: TaskId, stepId: StepId });

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
  intent: intentSchema,
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

/** Every request the service worker serves. Single source of truth for all contexts. */
export const protocol = defineProtocol({
  'system.ping': {
    request: z.object({ nonce: z.string().check(z.minLength(1)) }),
    response: z.object({ nonce: z.string(), version: z.string(), receivedAt: z.number() }),
  },
  /** Screenshot of the calling tab's viewport, stored as an asset. Content scripts only. */
  'capture.snapshot': {
    request: z.object({}),
    response: imageSchema,
  },
  /** Crops, outlines and masks a stored snapshot into a new asset. */
  'capture.deriveImage': {
    request: imageDerivationSchema,
    response: imageSchema,
  },
  /** Stores a captured step: its facts plus the collected fragments, validated per kind. */
  /** Adds a captured step to the active draft (creating one if needed). */
  'capture.commitStep': {
    request: z.object({ step: stepRecordSchema, capture: stepCaptureEnvelopeSchema }),
    response: z.object({
      taskId: TaskId,
      stepId: StepId,
      stepCount: z.int().check(z.positive()),
    }),
  },
  /** Starts capture in a tab the extension may access (activeTab grant or host permission). */
  'capture.start': {
    request: z.object({ tabId: z.int().check(z.nonnegative()) }),
    response: captureStartResponseSchema,
  },
  /** Drafts, most recently changed first, and the one new steps go to. */
  'drafts.list': {
    request: empty,
    response: z.object({
      activeId: z.nullable(TaskId),
      drafts: z.readonly(z.array(draftSummarySchema)),
    }),
  },
  'drafts.get': { request: taskRef, response: draftViewSchema },
  /** Creates an empty draft and makes it active. */
  'drafts.create': { request: empty, response: taskRef },
  /** Makes a draft the one new steps go to. */
  'drafts.activate': { request: taskRef, response: empty },
  'drafts.rename': {
    request: z.object({ taskId: TaskId, title: z.string().check(z.maxLength(MAX_TITLE_LENGTH)) }),
    response: empty,
  },
  /** Deletes a draft with its collected context. */
  'drafts.delete': { request: taskRef, response: empty },
  'steps.editComment': {
    request: z.object({
      taskId: TaskId,
      stepId: StepId,
      comment: z.string().check(z.maxLength(MAX_COMMENT_LENGTH)),
    }),
    response: empty,
  },
  'steps.move': {
    request: z.object({ taskId: TaskId, stepId: StepId, toIndex: z.int().check(z.nonnegative()) }),
    response: empty,
  },
  'steps.remove': { request: stepRef, response: empty },
  /**
   * Assembles the task into a frozen bundle and describes it. The same bundle is delivered
   * later, so the preview shows exactly what will be sent.
   */
  'task.assemble': { request: taskRef, response: bundlePreviewSchema },
});

/** Every request a tab's content script serves. Sent by the service worker. */
export const tabProtocol = defineProtocol({
  'capture.start': {
    request: z.object({}),
    response: captureStartResponseSchema,
  },
});

/** Every event the service worker broadcasts to UI contexts. */
export const events = defineEvents({
  'system.pinged': z.object({ nonce: z.string(), at: z.number() }),
  /** A draft was created, changed or deleted; `activeId` is the draft new steps go to. */
  'drafts.changed': z.object({ taskId: TaskId, activeId: z.nullable(TaskId) }),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
export type TabProtocol = typeof tabProtocol;
