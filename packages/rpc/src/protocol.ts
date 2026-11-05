import { assetRefSchema, intentSchema, stepCaptureEnvelopeSchema } from '@redline/core';
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
  comment: z.string().check(z.minLength(1)),
  viewport: z.object({
    width: z.int().check(z.positive()),
    height: z.int().check(z.positive()),
    devicePixelRatio: z.number().check(z.positive()),
    scrollX: z.number(),
    scrollY: z.number(),
  }),
  shapeIds: z.readonly(z.array(z.string().check(z.minLength(1))).check(z.minLength(1))),
});
export type StepRecord = z.infer<typeof stepRecordSchema>;

export const captureStartResponseSchema = z.object({
  status: z.enum(['started', 'already-active']),
});
export type CaptureStartResponse = z.infer<typeof captureStartResponseSchema>;

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
  'capture.commitStep': {
    request: z.object({ step: stepRecordSchema, capture: stepCaptureEnvelopeSchema }),
    response: z.object({ captureId: z.string() }),
  },
  /** Starts capture in a tab the extension may access (activeTab grant or host permission). */
  'capture.start': {
    request: z.object({ tabId: z.int().check(z.nonnegative()) }),
    response: captureStartResponseSchema,
  },
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
  'step.captured': z.object({ captureId: z.string() }),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
export type TabProtocol = typeof tabProtocol;
