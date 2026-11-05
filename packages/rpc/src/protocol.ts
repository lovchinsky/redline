import {
  ProjectId,
  StepId,
  TaskId,
  bindingSchema,
  taskStateSchema,
  assetRefSchema,
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
  comment: z.string(),
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

export const taskSummarySchema = z.object({
  id: TaskId,
  title: z.nullable(z.string()),
  firstComment: z.nullable(z.string()),
  stepCount: z.int().check(z.nonnegative()),
  updatedAt: z.number(),
  state: taskStateSchema,
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

const projectSchema = z.object({ id: ProjectId, name: z.string().check(z.minLength(1)) });
export type ProjectRef = z.infer<typeof projectSchema>;

/** Where a draft would go: each site of its steps with its binding, and the project if clear. */
export const deliveryTargetSchema = z.object({
  sites: z.readonly(z.array(z.object({ origin: z.string(), binding: z.nullable(bindingSchema) }))),
  /** The one project every bound site agrees on; `null` if none is bound yet or they disagree. */
  project: z.nullable(projectSchema),
  /** Sites are bound to different projects: the draft has to be split. */
  conflict: z.boolean(),
});
export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;

export const receiverViewSchema = z.object({
  baseUrl: z.string(),
  hasToken: z.boolean(),
});
export type ReceiverView = z.infer<typeof receiverViewSchema>;

export const collectorRunSchema = z.object({
  collector: z.string(),
  /** 1-based number of the area; `null` for collectors that run once per step. */
  area: z.nullable(z.int().check(z.positive())),
  outcome: z.enum([
    'collected',
    'not-applicable',
    'unavailable',
    'failed',
    'timed-out',
    'invalid-output',
  ]),
  durationMs: z.number().check(z.nonnegative()),
  fragments: z.int().check(z.nonnegative()),
});

/** How collecting context for one step went, as the page reports it. */
export const captureReportSchema = z.object({
  /** Origin and path of the page, without query or fragment. */
  page: z.string(),
  areas: z.int().check(z.positive()),
  durationMs: z.number().check(z.nonnegative()),
  collectors: z.readonly(z.array(collectorRunSchema)),
});
export type CaptureReportInput = z.infer<typeof captureReportSchema>;

/** A journal entry: the report, stamped by the service worker. */
export const captureRecordSchema = z.extend(captureReportSchema, {
  id: z.string(),
  at: z.number(),
});
export type CaptureRecord = z.infer<typeof captureRecordSchema>;

/** Every request the service worker serves. Single source of truth for all contexts. */
export const protocol = defineProtocol({
  'system.ping': {
    request: z.object({ nonce: z.string().check(z.minLength(1)) }),
    response: z.object({ nonce: z.string(), version: z.string(), receivedAt: z.number() }),
    callers: ['extension'],
  },
  /** Screenshot of the calling tab's viewport, stored as an asset. */
  'capture.snapshot': {
    request: z.object({}),
    response: imageSchema,
    callers: ['content-script'],
  },
  /** Crops, outlines and masks a stored snapshot into a new asset. */
  'capture.deriveImage': {
    request: imageDerivationSchema,
    response: imageSchema,
    callers: ['content-script'],
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
    callers: ['content-script'],
  },
  /** Runs the page runtime in the calling frame's MAIN world. */
  'capture.injectPageRuntime': { request: empty, response: empty, callers: ['content-script'] },
  /** Starts capture in a tab the extension may access (activeTab grant or host permission). */
  'capture.start': {
    request: z.object({ tabId: z.int().check(z.nonnegative()) }),
    response: captureStartResponseSchema,
    callers: ['extension'],
  },
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
  /**
   * Assembles the task into a frozen bundle and describes it. The same bundle is delivered
   * later, so the preview shows exactly what will be sent.
   */
  'task.assemble': { request: taskRef, response: bundlePreviewSchema, callers: ['extension'] },
  /** Which project a draft would be delivered to, from the bindings of its sites. */
  'task.deliveryTarget': {
    request: taskRef,
    response: deliveryTargetSchema,
    callers: ['extension'],
  },
  /**
   * Queues a draft for delivery. `revision` is the draft the user saw: a newer one is refused
   * (`draft-changed`). `project` binds the draft's unbound sites to it; `null` relies on the
   * existing bindings. The frozen bundle of that revision is what gets sent.
   */
  'task.submit': {
    request: z.object({
      taskId: TaskId,
      revision: z.int().check(z.nonnegative()),
      project: z.nullable(projectSchema),
    }),
    response: empty,
    callers: ['extension'],
  },
  /** Sends a refused or waiting task again now. */
  'task.retry': { request: taskRef, response: empty, callers: ['extension'] },
  /** Turns a refused task back into the active draft. */
  'task.reopen': { request: taskRef, response: empty, callers: ['extension'] },
  /** Asks the receiver for news now, if its polling interval allows. */
  'task.refresh': { request: taskRef, response: empty, callers: ['extension'] },
  'task.reply': {
    request: z.object({
      taskId: TaskId,
      questionId: z.string().check(z.minLength(1)),
      text: z.string(),
    }),
    response: empty,
    callers: ['extension'],
  },
  /** Tasks past the draft stage, most recently changed first. */
  'tasks.list': {
    request: empty,
    response: z.object({ tasks: z.readonly(z.array(taskSummarySchema)) }),
    callers: ['extension'],
  },
  /** Deletes a task in any state, with its collected context. */
  'tasks.delete': { request: taskRef, response: empty, callers: ['extension'] },
  'receiver.get': {
    request: empty,
    response: z.object({ receiver: z.nullable(receiverViewSchema) }),
    callers: ['extension'],
  },
  /** `token` omitted keeps the stored one; `null` removes it. */
  'receiver.configure': {
    request: z.object({ baseUrl: z.string(), token: z.optional(z.nullable(z.string())) }),
    response: empty,
    callers: ['extension'],
  },
  'receiver.clear': { request: empty, response: empty, callers: ['extension'] },
  'projects.list': {
    request: empty,
    response: z.object({ projects: z.readonly(z.array(projectSchema)) }),
    callers: ['extension'],
  },
  'bindings.list': {
    request: empty,
    response: z.object({ bindings: z.readonly(z.array(bindingSchema)) }),
    callers: ['extension'],
  },
  /** Binds a site pattern to a project; responds with the pattern in canonical form. */
  'bindings.set': {
    request: z.object({ pattern: z.string(), project: projectSchema }),
    response: z.object({ pattern: z.string() }),
    callers: ['extension'],
  },
  'bindings.remove': {
    request: z.object({ pattern: z.string() }),
    response: empty,
    callers: ['extension'],
  },
  /** Adds a capture to the local Diagnostics journal. */
  'diagnostics.record': {
    request: captureReportSchema,
    response: empty,
    callers: ['content-script'],
  },
  /** The journal, most recent first. */
  'diagnostics.list': {
    request: empty,
    response: z.object({ records: z.readonly(z.array(captureRecordSchema)) }),
    callers: ['extension'],
  },
  'diagnostics.clear': { request: empty, response: empty, callers: ['extension'] },
});

/** Every request a tab's content script serves. Sent by the service worker. */
export const tabProtocol = defineProtocol({
  'capture.start': {
    request: z.object({}),
    response: captureStartResponseSchema,
    callers: ['extension'],
  },
});

/** Every event the service worker broadcasts to UI contexts. */
export const events = defineEvents({
  'system.pinged': z.object({ nonce: z.string(), at: z.number() }),
  /** A task was created, changed or deleted; `activeId` is the draft new steps go to. */
  'tasks.changed': z.object({ taskId: TaskId, activeId: z.nullable(TaskId) }),
  /** Receiver settings or bindings changed. */
  'settings.changed': z.object({}),
  'diagnostics.changed': z.object({}),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
export type TabProtocol = typeof tabProtocol;
