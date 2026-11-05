import type { AssetRef, FragmentKind, FragmentRegistry, Logger, Priority } from '@redline/core';
import type { DomQuery } from '@redline/dom';
import type * as z from 'zod/mini';
import type { ImagePort } from './ports';
import type { PageInfo, ShapeSubject, StepSubject } from './subject';

/** Everything a collector may use. Collectors never reach for globals or extension APIs. */
export interface CaptureContext {
  readonly document: Document;
  readonly dom: DomQuery;
  readonly page: PageInfo;
  readonly images: ImagePort;
  readonly log: Logger;
}

export interface StepInput<Options> {
  readonly context: CaptureContext;
  readonly step: StepSubject;
  readonly options: Options;
  /** Aborted when the collector exceeds its time budget. */
  readonly signal: AbortSignal;
}

export interface ShapeInput<Options> extends StepInput<Options> {
  readonly shape: ShapeSubject;
}

export interface CollectedItem<Data> {
  readonly data: Data;
  readonly priority?: Priority;
  readonly assets?: readonly AssetRef[];
}

export type CollectorOutcome<Data> =
  | { readonly status: 'collected'; readonly items: readonly CollectedItem<Data>[] }
  | { readonly status: 'not-applicable'; readonly reason: string };

interface CollectorBase<Kind extends string, Schema extends z.ZodMiniType> {
  readonly id: string;
  readonly produces: Kind;
  readonly optionsSchema: Schema;
  readonly priority: Priority;
}

export interface ShapeCollector<
  Kind extends string,
  Schema extends z.ZodMiniType,
  Data,
> extends CollectorBase<Kind, Schema> {
  readonly level: 'shape';
  collect(input: ShapeInput<z.output<Schema>>): Promise<CollectorOutcome<Data>>;
}

export interface StepCollector<
  Kind extends string,
  Schema extends z.ZodMiniType,
  Data,
> extends CollectorBase<Kind, Schema> {
  readonly level: 'step';
  collect(input: StepInput<z.output<Schema>>): Promise<CollectorOutcome<Data>>;
}

/** Collects one fragment kind, once per step or once per shape. */
export type Collector<K extends FragmentKind, Schema extends z.ZodMiniType> =
  ShapeCollector<K, Schema, FragmentRegistry[K]> | StepCollector<K, Schema, FragmentRegistry[K]>;

/** Kind-agnostic view used by the planner and engine; every `Collector` is assignable to it. */
export type ErasedCollector =
  ShapeCollector<string, z.ZodMiniType, unknown> | StepCollector<string, z.ZodMiniType, unknown>;

export const defineCollector = <K extends FragmentKind, Schema extends z.ZodMiniType>(
  collector: Collector<K, Schema>,
): Collector<K, Schema> => collector;
