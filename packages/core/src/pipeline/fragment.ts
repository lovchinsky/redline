import * as z from 'zod/mini';
import { assetRefSchema, type AssetRef } from '../ports/asset-store';

/**
 * Data type of every fragment kind, keyed by kind. Empty here: each context module adds
 * its own entry through declaration merging, so new kinds never edit a central union.
 *
 *   declare module '@redline/core' {
 *     interface FragmentRegistry { anchors: AnchorsData }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extended by modules
export interface FragmentRegistry {}

export type FragmentKind = Extract<keyof FragmentRegistry, string>;

export const fragmentTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('shape'), shapeId: z.string().check(z.minLength(1)) }),
  z.object({ level: z.literal('step') }),
]);
export type FragmentTarget = z.infer<typeof fragmentTargetSchema>;

export const PRIORITIES = ['critical', 'high', 'normal', 'low'] as const;
export const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

/** Kind-agnostic view of a fragment, used by pipeline machinery that handles every kind. */
export interface FragmentBase {
  readonly kind: string;
  /** Version of the module's data schema the data was written with. */
  readonly version: number;
  readonly target: FragmentTarget;
  readonly priority: Priority;
  readonly data: unknown;
  /** Binary assets (screenshots) referenced by `data`. */
  readonly assets: readonly AssetRef[];
}

/** One typed piece of context about a step or one of its shapes. Plain, serializable data. */
export interface Fragment<K extends FragmentKind> extends FragmentBase {
  readonly kind: K;
  readonly data: FragmentRegistry[K];
}

/** Union of every registered fragment (narrows by `kind`); the base view while none is registered. */
export type AnyFragment = [FragmentKind] extends [never]
  ? FragmentBase
  : { [K in FragmentKind]: Fragment<K> }[FragmentKind];

/** Wire shape of a fragment before its data is validated against the module's schema. */
export const fragmentEnvelopeSchema = z.object({
  kind: z.string().check(z.minLength(1)),
  version: z.int().check(z.positive()),
  target: fragmentTargetSchema,
  priority: prioritySchema,
  data: z.unknown(),
  assets: z.readonly(z.array(assetRefSchema)),
});
export type FragmentEnvelope = z.infer<typeof fragmentEnvelopeSchema>;

export const diagnosticSchema = z.object({
  /** Collector or processor id. */
  source: z.string(),
  target: fragmentTargetSchema,
  outcome: z.enum(['failed', 'timed-out', 'invalid-output', 'not-applicable']),
  message: z.string(),
  durationMs: z.number().check(z.nonnegative()),
});
/** What went wrong (or did not apply) while collecting. Kept for diagnostics, never rendered. */
export type Diagnostic = z.infer<typeof diagnosticSchema>;

/** Result of collecting context for one step: fragments plus diagnostics. */
export interface StepCapture {
  readonly fragments: readonly AnyFragment[];
  readonly diagnostics: readonly Diagnostic[];
}

export const stepCaptureEnvelopeSchema = z.object({
  fragments: z.readonly(z.array(fragmentEnvelopeSchema)),
  diagnostics: z.readonly(z.array(diagnosticSchema)),
});

export const sameTarget = (a: FragmentTarget, b: FragmentTarget): boolean =>
  a.level === b.level && (a.level === 'step' || (b.level === 'shape' && a.shapeId === b.shapeId));
