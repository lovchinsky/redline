/** Capturing a step: from the page (content script) and from the toolbar or side panel. */
import {
  StepId,
  TaskId,
  assetRefSchema,
  stepCaptureEnvelopeSchema,
  viewportSchema,
} from '@redline/core';
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';
import { empty } from './shared';

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

export const captureMethods = defineProtocol({
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
});

/** Every request a tab's content script serves. Sent by the service worker. */
export const tabProtocol = defineProtocol({
  'capture.start': {
    request: z.object({}),
    response: captureStartResponseSchema,
    callers: ['extension'],
  },
});
