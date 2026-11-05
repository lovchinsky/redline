import type { AppError, IdGenerator, Logger, Result } from '@redline/core';
import {
  summarizeRegion,
  type DomQuery,
  type RegionResolver,
  type ResolvedRegion,
} from '@redline/dom';
import { boundsOf, rectPolygon, type Point, type Polygon, type Rect } from '@redline/geometry';
import { render } from 'preact';
import {
  DEFAULT_MACHINE_CONFIG,
  initialCaptureState,
  transition,
  type CaptureEffect,
  type CaptureEvent,
  type CaptureState,
  type CaptureSubmission,
  type CapturedShape,
  type MachineConfig,
} from './capture-machine';
import {
  LassoRenderer,
  type Scene,
  type SceneHighlight,
  type SceneOutline,
} from './lasso-renderer';
import type { OverlayHost } from './overlay-host';
import { OverlayView } from './OverlayView';

export interface ResolvedShape {
  readonly shape: CapturedShape;
  /** Live element references: valid only in this content script, for the pipeline to read. */
  readonly region: ResolvedRegion;
}

export interface ResolvedCapture {
  readonly comment: CaptureSubmission['comment'];
  readonly intent: CaptureSubmission['intent'];
  readonly shapes: readonly ResolvedShape[];
}

export type SessionOutcome = 'committed' | 'cancelled';

export interface CaptureSessionDeps {
  readonly view: Window;
  readonly host: OverlayHost;
  readonly dom: DomQuery;
  readonly resolver: RegionResolver;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  /** Hands a finished step over for context collection. Failure keeps the composer open. */
  readonly commit: (capture: ResolvedCapture) => Promise<Result<void, AppError>>;
  readonly config?: MachineConfig;
}

/** Events from the overlay that must never reach page handlers (e.g. "click outside" closers). */
const ISOLATED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'focusin',
  'focusout',
] as const;

/**
 * One capture, from arming to commit or cancel. Translates DOM input into state machine
 * events, executes the machine's effects, and paints the overlay. Owns every listener and
 * DOM node it creates and removes them all when the session ends.
 */
export class CaptureSession {
  private state: CaptureState = initialCaptureState();
  private readonly regions = new Map<string, ResolvedRegion>();
  private readonly queue: CaptureEvent[] = [];
  private dispatching = false;
  private readonly renderer: LassoRenderer;
  private readonly reducedMotion: boolean;
  private readonly cleanups: (() => void)[] = [];
  private frame: number | null = null;
  private viewDirty = true;
  private ended = false;
  private readonly outcome = Promise.withResolvers<SessionOutcome>();

  constructor(private readonly deps: CaptureSessionDeps) {
    this.renderer = new LassoRenderer(deps.host.canvas, deps.view);
    this.reducedMotion = deps.view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Attaches input handling and resolves once the session has ended. */
  run(): Promise<SessionOutcome> {
    this.listen();
    this.update();
    return this.outcome.promise;
  }

  /** Ends the session immediately, e.g. when the extension is reloaded. */
  dispose(): void {
    this.close('cancelled');
  }

  private dispatch(event: CaptureEvent): void {
    this.queue.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        const { state, effects } = transition(this.state, next, {
          ids: this.deps.ids,
          config: this.deps.config ?? DEFAULT_MACHINE_CONFIG,
        });
        this.state = state;
        this.pruneRegions();
        for (const effect of effects) this.execute(effect);
      }
    } finally {
      this.dispatching = false;
    }
    this.update();
  }

  private execute(effect: CaptureEffect): void {
    switch (effect.type) {
      case 'resolve-shape':
        this.resolveShape(effect.shape);
        return;
      case 'commit':
        void this.commit(effect.submission);
        return;
      case 'close':
        this.close(this.state.kind === 'closed' ? this.state.outcome : 'cancelled');
        return;
    }
  }

  private resolveShape(shape: CapturedShape): void {
    const polygon =
      shape.source === 'click'
        ? this.pickedBox(shape)
        : shift(shape.polygon, this.offsetFrom(shape.scroll));
    const region = polygon === null ? null : this.deps.resolver.resolve(polygon);
    if (region === null) this.regions.delete(shape.id);
    else this.regions.set(shape.id, region);
    this.dispatch({
      type: 'shape-resolved',
      shapeId: shape.id,
      // Stored relative to the shape's own scroll offset, like the original stroke.
      polygon:
        polygon === null ? shape.polygon : shift(polygon, invert(this.offsetFrom(shape.scroll))),
      summary: region === null ? null : summarizeRegion(region),
    });
  }

  /** A click picks the topmost element under the pointer; its box becomes the outline. */
  private pickedBox(shape: CapturedShape): Polygon | null {
    const [point] = shift(shape.polygon, this.offsetFrom(shape.scroll));
    const element = point === undefined ? null : this.deps.dom.topmostAt(point);
    return element === null ? null : rectPolygon(this.deps.dom.rectOf(element));
  }

  private async commit(submission: CaptureSubmission): Promise<void> {
    const shapes: ResolvedShape[] = [];
    for (const shape of submission.shapes) {
      const region = this.regions.get(shape.id);
      if (region === undefined) {
        this.deps.logger.error('Submitted shape has no resolved region', { shapeId: shape.id });
        this.dispatch({ type: 'commit-failed' });
        return;
      }
      shapes.push({ shape, region });
    }
    const result = await this.deps.commit({
      comment: submission.comment,
      intent: submission.intent,
      shapes,
    });
    if (!result.ok) this.deps.logger.error('Committing the step failed', { ...result.error });
    this.dispatch(result.ok ? { type: 'commit-succeeded' } : { type: 'commit-failed' });
  }

  private pruneRegions(): void {
    const live = new Set(
      this.state.kind === 'closed' ? [] : this.state.shapes.map((e) => e.shape.id),
    );
    for (const id of this.regions.keys()) if (!live.has(id)) this.regions.delete(id);
  }

  private listen(): void {
    const { host, view } = this.deps;
    const canvas = host.canvas;
    const onCanvas = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, handler, options);
      this.cleanups.push(() => {
        canvas.removeEventListener(type, handler, options);
      });
    };
    const onWindow = <K extends keyof WindowEventMap>(
      type: K,
      handler: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      view.addEventListener(type, handler, options);
      this.cleanups.push(() => {
        view.removeEventListener(type, handler, options);
      });
    };

    onCanvas('pointerdown', (event) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this.dispatch({ type: 'pointer-down', point: pointOf(event), scroll: this.scroll() });
    });
    onCanvas('pointermove', (event) => {
      if (this.state.kind !== 'drawing') return;
      const samples = event.getCoalescedEvents();
      for (const sample of samples.length > 0 ? samples : [event]) {
        this.dispatch({ type: 'pointer-move', point: pointOf(sample) });
      }
    });
    onCanvas('pointerup', (event) => {
      if (this.state.kind === 'drawing')
        this.dispatch({ type: 'pointer-up', point: pointOf(event) });
    });
    onCanvas('pointercancel', () => {
      this.dispatch({ type: 'pointer-cancel' });
    });
    // The outline is stored in viewport coordinates, so the page must not scroll mid-stroke.
    onCanvas(
      'wheel',
      (event) => {
        if (this.state.kind === 'drawing') event.preventDefault();
      },
      { passive: false },
    );
    onWindow(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.dispatch({ type: 'escape' });
      },
      { capture: true },
    );
    // Capture phase also catches scrolling inside page containers, which moves highlights.
    onWindow(
      'scroll',
      () => {
        this.viewDirty = true;
        this.requestFrame();
      },
      { capture: true, passive: true },
    );
    onWindow('resize', () => {
      this.renderer.resize();
      this.viewDirty = true;
      this.requestFrame();
    });
    this.cleanups.push(host.isolateEvents(ISOLATED_EVENTS));
  }

  /** Applies a state change: input mode, panel and canvas. */
  private update(): void {
    if (this.state.kind === 'closed') return;
    this.deps.host.setDrawingEnabled(this.state.kind !== 'committing');
    this.viewDirty = true;
    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.frame !== null || this.state.kind === 'closed') return;
    this.frame = this.deps.view.requestAnimationFrame((time) => {
      this.frame = null;
      this.paint(time);
    });
  }

  private paint(time: number): void {
    if (this.state.kind === 'closed') return;
    const scene = this.scene(this.state);
    this.renderer.render(scene, this.reducedMotion ? 0 : time);
    if (this.viewDirty) {
      this.viewDirty = false;
      this.renderView(this.state);
    }
    if (!this.reducedMotion && scene.outlines.length > 0) this.requestFrame();
  }

  private renderView(state: Exclude<CaptureState, { kind: 'closed' }>): void {
    const { view } = this.deps;
    render(
      <OverlayView
        state={state}
        anchor={this.anchorOf(state)}
        viewport={{ width: view.innerWidth, height: view.innerHeight }}
        onCommentChange={(comment) => {
          this.dispatch({ type: 'comment-changed', comment });
        }}
        onIntentSelect={(intent) => {
          this.dispatch({ type: 'intent-selected', intent });
        }}
        onRemoveLastShape={() => {
          this.dispatch({ type: 'remove-last-shape' });
        }}
        onSubmit={() => {
          this.dispatch({ type: 'submit' });
        }}
        onCancel={() => {
          this.dispatch({ type: 'escape' });
        }}
      />,
      this.deps.host.ui,
    );
  }

  private scene(state: Exclude<CaptureState, { kind: 'closed' }>): Scene {
    const outlines: SceneOutline[] = state.shapes.map(({ shape }) => ({
      points: shape.polygon,
      offset: this.offsetFrom(shape.scroll),
      smooth: shape.source === 'lasso',
      closed: true,
    }));
    if (state.kind === 'drawing') {
      outlines.push({
        points: state.stroke,
        offset: this.offsetFrom(state.scroll),
        smooth: true,
        closed: false,
      });
    }

    const highlights: SceneHighlight[] = [];
    for (const { shape } of state.shapes) {
      const region = this.regions.get(shape.id);
      if (region === undefined) continue;
      highlights.push({ rect: this.deps.dom.rectOf(region.container), role: 'container' });
      for (const group of region.groups) {
        for (const element of group.elements) {
          highlights.push({ rect: this.deps.dom.rectOf(element), role: 'selected' });
        }
      }
    }

    return {
      outlines,
      highlights,
      dimOutside: state.kind === 'composing' || state.kind === 'committing',
    };
  }

  /** On-screen bounds of the most recent shape, for placing the composer. */
  private anchorOf(state: Exclude<CaptureState, { kind: 'closed' }>): Rect | null {
    const last = state.shapes.at(-1);
    if (last === undefined) return null;
    return boundsOf(shift(last.shape.polygon, this.offsetFrom(last.shape.scroll)));
  }

  private scroll(): Point {
    return { x: this.deps.view.scrollX, y: this.deps.view.scrollY };
  }

  /** How far content captured at `scroll` has moved on screen since. */
  private offsetFrom(scroll: Point): Point {
    const now = this.scroll();
    return { x: scroll.x - now.x, y: scroll.y - now.y };
  }

  /** Tears everything down exactly once. */
  private close(outcome: SessionOutcome): void {
    if (this.ended) return;
    this.ended = true;
    this.state = { kind: 'closed', outcome };
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.frame !== null) this.deps.view.cancelAnimationFrame(this.frame);
    this.frame = null;
    render(null, this.deps.host.ui);
    this.deps.host.remove();
    this.outcome.resolve(outcome);
  }
}

const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

const shift = (polygon: Polygon, by: Point): Point[] =>
  polygon.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));

const invert = (point: Point): Point => ({ x: -point.x, y: -point.y });
