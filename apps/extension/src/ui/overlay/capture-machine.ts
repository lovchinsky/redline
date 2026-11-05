import type { IdGenerator } from '@redline/core';
import type { RegionSummary } from '@redline/dom';
import { boundsOf, pathLength, simplifyPath, type Point, type Polygon } from '@redline/geometry';

/**
 * Capture interaction as an explicit state machine. `transition` is pure: it never touches
 * the DOM; side effects are returned as data and executed by the controller.
 *
 *   armed ──pointer-down──▶ drawing ──pointer-up──▶ composing ──submit──▶ committing ──▶ closed
 *     ▲  ◀──escape (no shapes)──┘ ▲   ◀──pointer-down (another shape)──┘      │
 *     └──────────escape───────────┴──────────────────────────────── commit-failed ─┘ (→ composing)
 *
 * Keyboard alternative to drawing: armed / composing ──keyboard-start──▶ picking
 * ──element-picked──▶ composing; escape leaves picking without adding a shape.
 */

export interface CapturedShape {
  readonly id: string;
  readonly source: 'lasso' | 'click' | 'keyboard';
  /** Viewport coordinates at the moment of capture. */
  readonly polygon: Polygon;
  /** Page scroll offset at the moment of capture, to keep the outline in place after scrolling. */
  readonly scroll: Point;
}

export type ShapeResolution =
  | { readonly status: 'pending' }
  | { readonly status: 'resolved'; readonly summary: RegionSummary }
  | { readonly status: 'empty' };

export interface ShapeEntry {
  readonly shape: CapturedShape;
  readonly resolution: ShapeResolution;
}

export type DraftProblem =
  'comment-required' | 'resolution-pending' | 'empty-shape' | 'commit-failed';

export interface Draft {
  readonly comment: string;
  readonly problem: DraftProblem | null;
}

interface Base {
  readonly shapes: readonly ShapeEntry[];
  readonly draft: Draft;
}

export type CaptureState =
  | (Base & { readonly kind: 'armed' })
  | (Base & { readonly kind: 'drawing'; readonly stroke: readonly Point[]; readonly scroll: Point })
  | (Base & { readonly kind: 'picking' })
  | (Base & { readonly kind: 'composing' })
  | (Base & { readonly kind: 'committing' })
  | { readonly kind: 'closed'; readonly outcome: 'cancelled' | 'committed' };

export type CaptureEvent =
  | { readonly type: 'pointer-down'; readonly point: Point; readonly scroll: Point }
  | { readonly type: 'pointer-move'; readonly point: Point }
  | { readonly type: 'pointer-up'; readonly point: Point }
  | { readonly type: 'pointer-cancel' }
  | { readonly type: 'keyboard-start' }
  /** The element chosen with the keyboard: its box, in viewport coordinates at `scroll`. */
  | { readonly type: 'element-picked'; readonly box: Polygon; readonly scroll: Point }
  | {
      readonly type: 'shape-resolved';
      readonly shapeId: string;
      /** Replaces the outline, e.g. a click becomes the picked element's box. */
      readonly polygon: Polygon;
      readonly summary: RegionSummary | null;
    }
  | { readonly type: 'comment-changed'; readonly comment: string }
  | { readonly type: 'remove-last-shape' }
  | { readonly type: 'submit' }
  | { readonly type: 'escape' }
  | { readonly type: 'commit-succeeded' }
  | { readonly type: 'commit-failed' };

export interface CaptureSubmission {
  readonly shapes: readonly CapturedShape[];
  readonly comment: string;
}

export type CaptureEffect =
  | { readonly type: 'resolve-shape'; readonly shape: CapturedShape }
  | { readonly type: 'commit'; readonly submission: CaptureSubmission }
  | { readonly type: 'close' };

export interface MachineConfig {
  /** A stroke whose bounding box is smaller than this (CSS px) is a click, not a lasso. */
  readonly clickTolerance: number;
  /** Strokes are simplified with this tolerance (CSS px) before being stored. */
  readonly simplifyTolerance: number;
  /** Consecutive pointer samples closer than this (CSS px) are dropped. */
  readonly minPointDistance: number;
  readonly maxShapes: number;
}

export const DEFAULT_MACHINE_CONFIG: MachineConfig = {
  clickTolerance: 6,
  simplifyTolerance: 1.5,
  minPointDistance: 2,
  maxShapes: 10,
};

export interface MachineContext {
  readonly ids: IdGenerator;
  readonly config: MachineConfig;
}

export interface Transition {
  readonly state: CaptureState;
  readonly effects: readonly CaptureEffect[];
}

export const EMPTY_DRAFT: Draft = { comment: '', problem: null };

export const initialCaptureState = (): CaptureState => ({
  kind: 'armed',
  shapes: [],
  draft: EMPTY_DRAFT,
});

const stay = (state: CaptureState): Transition => ({ state, effects: [] });

const afterShapes = (base: Base): CaptureState =>
  base.shapes.length > 0 ? { kind: 'composing', ...base } : { kind: 'armed', ...base };

export const transition = (
  state: CaptureState,
  event: CaptureEvent,
  context: MachineContext,
): Transition => {
  switch (state.kind) {
    case 'armed':
    case 'composing':
      return fromArmedOrComposing(state, event, context);
    case 'drawing':
      return fromDrawing(state, event, context);
    case 'picking':
      return fromPicking(state, event, context);
    case 'committing':
      return fromCommitting(state, event);
    case 'closed':
      return stay(state);
  }
};

const fromArmedOrComposing = (
  state: Extract<CaptureState, { kind: 'armed' | 'composing' }>,
  event: CaptureEvent,
  { config }: MachineContext,
): Transition => {
  const base: Base = { shapes: state.shapes, draft: state.draft };
  switch (event.type) {
    case 'pointer-down':
      return stay({ kind: 'drawing', ...base, stroke: [event.point], scroll: event.scroll });
    case 'keyboard-start':
      return state.shapes.length < config.maxShapes
        ? stay({ kind: 'picking', ...base })
        : stay(state);
    case 'shape-resolved':
      return stay({ ...state, shapes: applyResolution(state.shapes, event) });
    case 'comment-changed':
      return stay({ ...state, draft: { ...state.draft, comment: event.comment, problem: null } });
    case 'remove-last-shape':
      return stay(afterShapes({ ...base, shapes: state.shapes.slice(0, -1) }));
    case 'submit':
      return state.kind === 'composing' ? submit(state) : stay(state);
    case 'escape':
      return state.kind === 'armed'
        ? { state: { kind: 'closed', outcome: 'cancelled' }, effects: [{ type: 'close' }] }
        : stay(initialCaptureState());
    default:
      return stay(state);
  }
};

const fromDrawing = (
  state: Extract<CaptureState, { kind: 'drawing' }>,
  event: CaptureEvent,
  { ids, config }: MachineContext,
): Transition => {
  const base: Base = { shapes: state.shapes, draft: state.draft };
  switch (event.type) {
    case 'pointer-move': {
      const last = state.stroke.at(-1);
      const farEnough =
        last === undefined ||
        Math.hypot(event.point.x - last.x, event.point.y - last.y) >= config.minPointDistance;
      return farEnough ? stay({ ...state, stroke: [...state.stroke, event.point] }) : stay(state);
    }
    case 'pointer-up': {
      if (state.shapes.length >= config.maxShapes) return stay(afterShapes(base));
      return addShape(
        base,
        toShape(ids.next(), [...state.stroke, event.point], state.scroll, config),
      );
    }
    case 'pointer-cancel':
    case 'escape':
      return stay(afterShapes(base));
    case 'shape-resolved':
      return stay({ ...state, shapes: applyResolution(state.shapes, event) });
    default:
      return stay(state);
  }
};

const fromPicking = (
  state: Extract<CaptureState, { kind: 'picking' }>,
  event: CaptureEvent,
  { ids }: MachineContext,
): Transition => {
  const base: Base = { shapes: state.shapes, draft: state.draft };
  switch (event.type) {
    case 'element-picked':
      return addShape(base, {
        id: ids.next(),
        source: 'keyboard',
        polygon: event.box,
        scroll: event.scroll,
      });
    case 'escape':
      return stay(afterShapes(base));
    case 'shape-resolved':
      return stay({ ...state, shapes: applyResolution(state.shapes, event) });
    default:
      return stay(state);
  }
};

const fromCommitting = (
  state: Extract<CaptureState, { kind: 'committing' }>,
  event: CaptureEvent,
): Transition => {
  switch (event.type) {
    case 'commit-succeeded':
      return { state: { kind: 'closed', outcome: 'committed' }, effects: [{ type: 'close' }] };
    case 'commit-failed':
      return stay({
        kind: 'composing',
        shapes: state.shapes,
        draft: { ...state.draft, problem: 'commit-failed' },
      });
    default:
      return stay(state);
  }
};

/** A new shape is resolved before the step can be committed. */
const addShape = (base: Base, shape: CapturedShape): Transition => ({
  state: {
    kind: 'composing',
    shapes: [...base.shapes, { shape, resolution: { status: 'pending' } }],
    draft: { ...base.draft, problem: null },
  },
  effects: [{ type: 'resolve-shape', shape }],
});

const toShape = (
  id: string,
  stroke: readonly Point[],
  scroll: Point,
  config: MachineConfig,
): CapturedShape => {
  const bounds = boundsOf(stroke);
  const isClick = bounds === null || Math.max(bounds.width, bounds.height) < config.clickTolerance;
  const polygon = simplifyPath(stroke, config.simplifyTolerance);
  if (isClick || polygon.length < 3 || pathLength(polygon, true) === 0) {
    const point = stroke.at(-1) ?? { x: 0, y: 0 };
    return { id, source: 'click', polygon: [point], scroll };
  }
  return { id, source: 'lasso', polygon, scroll };
};

const applyResolution = (
  shapes: readonly ShapeEntry[],
  event: Extract<CaptureEvent, { type: 'shape-resolved' }>,
): ShapeEntry[] =>
  shapes.map((entry) =>
    entry.shape.id === event.shapeId
      ? {
          shape: { ...entry.shape, polygon: event.polygon },
          resolution:
            event.summary === null
              ? { status: 'empty' }
              : { status: 'resolved', summary: event.summary },
        }
      : entry,
  );

const problemOf = (state: Base): DraftProblem | null => {
  if (state.shapes.some((entry) => entry.resolution.status === 'pending'))
    return 'resolution-pending';
  if (state.shapes.some((entry) => entry.resolution.status === 'empty')) return 'empty-shape';
  if (state.draft.comment.trim() === '') return 'comment-required';
  return null;
};

const submit = (state: Extract<CaptureState, { kind: 'composing' }>): Transition => {
  const problem = problemOf(state);
  if (problem !== null) return stay({ ...state, draft: { ...state.draft, problem } });
  return {
    state: { kind: 'committing', shapes: state.shapes, draft: { ...state.draft, problem: null } },
    effects: [
      {
        type: 'commit',
        submission: {
          shapes: state.shapes.map((entry) => entry.shape),
          comment: state.draft.comment.trim(),
        },
      },
    ],
  };
};
