import type { ShapeSubject, StepSubject, ViewportSnapshot } from '@redline/capture';
import type { AppError, IdGenerator, Logger, Result } from '@redline/core';
import {
  describeElement,
  isRegionLive,
  summarizeRegion,
  type DomQuery,
  type ElementTraversal,
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
import type { ViewportSnapshots } from '../../ports/capture';
import type { Translator } from '../../ports/i18n';
import { TranslatorProvider } from '../shared/i18n';
import type { OverlayHost } from './overlay-host';
import { ComposerFrame } from './composer-frame';
import type { ComposerView, FromComposer } from './composer-messages';
import { OverlayView } from './OverlayView';

/** What a shape resolved to: live elements (content script only) and the page it was drawn on. */
interface ShapeResolution {
  readonly region: ResolvedRegion;
  readonly snapshot: ViewportSnapshot | null;
}

export type SessionOutcome = 'committed' | 'cancelled';

export interface CaptureSessionDeps {
  readonly view: Window;
  readonly host: OverlayHost;
  readonly dom: DomQuery;
  readonly resolver: RegionResolver;
  /** Moves between page elements for picking with the keyboard. */
  readonly traversal: ElementTraversal;
  readonly i18n: Translator;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  readonly snapshots: ViewportSnapshots;
  /** Taken before the overlay appeared; reused while the page has not scrolled. */
  readonly initialSnapshot: ViewportSnapshot | null;
  /** Hands a finished step over for context collection. Failure keeps the composer open. */
  readonly commit: (step: StepSubject) => Promise<Result<unknown, AppError>>;
  /** The composer page and the extension's origin: what the user types never enters the page. */
  readonly composer: { readonly url: string; readonly origin: string };
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
  private readonly resolutions = new Map<string, ShapeResolution>();
  private snapshot: ViewportSnapshot | null;
  /** Snapshots are taken one at a time: each needs the overlay hidden. */
  private snapshotQueue: Promise<unknown> = Promise.resolve();
  /** Where the glow's turn stands; it only advances while it is moving. */
  private glowTime = 0;
  private readonly queue: CaptureEvent[] = [];
  private dispatching = false;
  private readonly renderer: LassoRenderer;
  private readonly reducedMotion: boolean;
  private readonly cleanups: (() => void)[] = [];
  private frame: number | null = null;
  /** The element keyboard picking is on, while picking. */
  private cursor: Element | null = null;
  /** What had focus on the page when capture started: where keyboard picking begins. */
  private readonly pageFocus: Element | null;
  /** The overlay's markup (hints), beside the composer frame. */
  private hints: HTMLElement | null = null;
  private composer: ComposerFrame | null = null;
  private composerOpen = false;
  private viewDirty = true;
  private ended = false;
  private readonly outcome = Promise.withResolvers<SessionOutcome>();

  constructor(private readonly deps: CaptureSessionDeps) {
    this.snapshot = deps.initialSnapshot;
    const focused = deps.view.document.activeElement;
    this.pageFocus =
      focused === null || focused === deps.view.document.body || deps.host.owns(focused)
        ? null
        : focused;
    this.renderer = new LassoRenderer(deps.host.canvas, deps.view);
    this.reducedMotion = deps.view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Attaches input handling and resolves once the session has ended. */
  run(): Promise<SessionOutcome> {
    const { ui } = this.deps.host;
    this.hints = ui.ownerDocument.createElement('div');
    ui.append(this.hints);
    this.composer = new ComposerFrame(this.deps.host.ui, {
      url: this.deps.composer.url,
      origin: this.deps.composer.origin,
      token: this.deps.ids.next(),
      title: this.deps.i18n.text('overlayLabel'),
      onMessage: (message) => {
        this.onComposer(message);
      },
    });
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
        void this.resolveShape(effect.shape);
        return;
      case 'commit':
        void this.commit(effect.submission);
        return;
      case 'close':
        this.close(this.state.kind === 'closed' ? this.state.outcome : 'cancelled');
        return;
    }
  }

  /**
   * Pairs the shape with a snapshot of the page as drawn, then resolves what it refers to.
   * The machine keeps the shape pending meanwhile, so a step cannot be committed half-resolved.
   */
  private async resolveShape(shape: CapturedShape): Promise<void> {
    const snapshot = await this.snapshotAt(shape.scroll);
    if (this.ended) return;
    const polygon =
      shape.source === 'click'
        ? this.pickedBox(shape)
        : shift(shape.polygon, this.offsetFrom(shape.scroll));
    const region = polygon === null ? null : this.deps.resolver.resolve(polygon);
    if (region === null) this.resolutions.delete(shape.id);
    else this.resolutions.set(shape.id, { region, snapshot });
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

  /** Snapshot matching the page at `scroll`: the current one if still valid, else a new one. */
  private snapshotAt(scroll: Point): Promise<ViewportSnapshot | null> {
    const next = this.snapshotQueue.then(async () => {
      const { view } = this.deps;
      const current = this.snapshot;
      if (current !== null && showsSameView(current, scroll, view)) return current;
      const taken = await this.withOverlayHidden(() => this.deps.snapshots.take());
      if (!taken.ok) {
        this.deps.logger.warn('Viewport snapshot failed; the step will have no screenshot', {
          ...taken.error,
        });
        return null;
      }
      this.snapshot = taken.value;
      return taken.value;
    });
    this.snapshotQueue = next;
    return next;
  }

  /** Hides the overlay until the page has painted without it, runs `task`, then restores it. */
  private async withOverlayHidden<T>(task: () => Promise<T>): Promise<T> {
    this.deps.host.setVisible(false);
    try {
      await afterNextPaint(this.deps.view);
      return await task();
    } finally {
      if (!this.ended) this.deps.host.setVisible(true);
    }
  }

  private async commit(submission: CaptureSubmission): Promise<void> {
    const shapes: ShapeSubject[] = [];
    for (const shape of submission.shapes) {
      const resolution = this.resolutions.get(shape.id);
      if (resolution === undefined) {
        this.deps.logger.error('Submitted shape has no resolved region', { shapeId: shape.id });
        this.dispatch({ type: 'commit-failed' });
        return;
      }
      const { snapshot } = resolution;
      const region = this.liveRegion(shape, resolution.region);
      // Express the outline in the coordinates of the snapshot it will be drawn on.
      const reference = snapshot?.scroll ?? this.scroll();
      shapes.push({
        id: shape.id,
        source: shape.source,
        polygon: shift(shape.polygon, {
          x: shape.scroll.x - reference.x,
          y: shape.scroll.y - reference.y,
        }),
        region,
        snapshot,
      });
    }
    const result = await this.deps.commit({
      comment: submission.comment,
      shapes,
    });
    if (!result.ok) this.deps.logger.error('Committing the step failed', { ...result.error });
    this.dispatch(result.ok ? { type: 'commit-succeeded' } : { type: 'commit-failed' });
  }

  /**
   * The region as the page is now. If the page re-rendered since the shape was drawn (the
   * circled elements were replaced while the user typed), the same outline is resolved again,
   * so context comes from the elements on screen rather than detached copies.
   */
  private liveRegion(shape: CapturedShape, region: ResolvedRegion): ResolvedRegion {
    if (isRegionLive(region)) return region;
    const again = this.deps.resolver.resolve(shift(shape.polygon, this.offsetFrom(shape.scroll)));
    if (again === null) {
      this.deps.logger.warn('The circled elements left the page', { shapeId: shape.id });
      return region;
    }
    return again;
  }

  private pruneRegions(): void {
    const live = new Set(
      this.state.kind === 'closed' ? [] : this.state.shapes.map((e) => e.shape.id),
    );
    for (const id of this.resolutions.keys()) if (!live.has(id)) this.resolutions.delete(id);
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
        if (!this.handleKey(event)) return;
        event.preventDefault();
        event.stopPropagation();
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

  /** Overlay shortcuts; returns whether the key was the overlay's (and not the page's). */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.dispatch({ type: 'escape' });
      return true;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (this.state.kind === 'armed' && event.key === 'Tab') {
      this.startPicking();
      return true;
    }
    if (this.state.kind !== 'picking' || this.cursor === null) return false;
    const { traversal } = this.deps;
    const cursor = this.cursor;
    switch (event.key) {
      case 'Tab':
        this.moveCursor(event.shiftKey ? traversal.previous(cursor) : traversal.next(cursor));
        return true;
      case 'ArrowUp':
        this.moveCursor(traversal.outer(cursor));
        return true;
      case 'ArrowDown':
        this.moveCursor(traversal.inner(cursor));
        return true;
      case 'Enter':
      case ' ':
        this.dispatch({
          type: 'element-picked',
          box: rectPolygon(this.deps.dom.rectOf(cursor)),
          scroll: this.scroll(),
        });
        return true;
      default:
        return false;
    }
  }

  /** What the user did in the composer frame. */
  private onComposer(message: FromComposer): void {
    switch (message.type) {
      case 'comment':
        this.dispatch({ type: 'comment-changed', comment: message.text });
        return;
      case 'submit':
        this.dispatch({ type: 'submit' });
        return;
      case 'cancel':
        this.dispatch({ type: 'escape' });
        return;
      case 'remove-last-shape':
        this.dispatch({ type: 'remove-last-shape' });
        return;
      case 'pick-keyboard':
        this.startPicking();
        return;
      case 'size':
        return;
    }
  }

  /**
   * Keyboard picking starts on what had focus on the page when capture began (the overlay's own
   * focus says nothing about the page), or on the first element on screen.
   */
  private startPicking(): void {
    const { view, dom, traversal } = this.deps;
    const focused = this.pageFocus;
    const start =
      focused !== null && focused.isConnected && dom.isVisible(focused)
        ? focused
        : traversal.first({ x: 0, y: 0, width: view.innerWidth, height: view.innerHeight });
    if (start === null) return;
    this.dispatch({ type: 'keyboard-start' });
    this.moveCursor(start);
  }

  private moveCursor(element: Element | null): void {
    if (element === null || this.state.kind !== 'picking') return;
    this.cursor = element;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.viewDirty = true;
    this.requestFrame();
  }

  /** Applies a state change: input mode, panel and canvas. */
  private update(): void {
    if (this.state.kind === 'closed') return;
    if (this.state.kind !== 'picking') this.cursor = null;
    // Pointer input stays on the canvas while picking, so a stray click never reaches the page.
    this.deps.host.setDrawingEnabled(this.state.kind !== 'committing');
    this.updateComposer(this.state);
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

  /**
   * The glow turns while the user is choosing what to circle; once they write the comment it
   * holds still, so the page is not repainted every frame for as long as they type.
   */
  private paint(time: number): void {
    if (this.state.kind === 'closed') return;
    const scene = this.scene(this.state);
    const moving =
      !this.reducedMotion &&
      scene.outlines.length > 0 &&
      this.state.kind !== 'composing' &&
      this.state.kind !== 'committing';
    if (moving) this.glowTime = time;
    this.renderer.render(scene, this.glowTime);
    if (this.viewDirty) {
      this.viewDirty = false;
      this.renderView(this.state);
    }
    if (moving) this.requestFrame();
  }

  /** Opens, updates or closes the composer frame to match the state. */
  private updateComposer(state: Exclude<CaptureState, { kind: 'closed' }>): void {
    const composer = this.composer;
    if (composer === null) return;
    if (state.kind !== 'composing' && state.kind !== 'committing') {
      if (this.composerOpen) composer.close();
      this.composerOpen = false;
      return;
    }
    const view: ComposerView = {
      shapes: state.shapes.map((entry) => entry.resolution),
      comment: state.draft.comment,
      problem: state.draft.problem,
      committing: state.kind === 'committing',
    };
    if (this.composerOpen) composer.update(view);
    else composer.open(view);
    this.composerOpen = true;
  }

  private renderView(state: Exclude<CaptureState, { kind: 'closed' }>): void {
    const anchor = this.anchorOf(state);
    if (this.composerOpen && anchor !== null) {
      this.composer?.placeNear(anchor, {
        width: this.deps.view.innerWidth,
        height: this.deps.view.innerHeight,
      });
    }
    if (this.hints === null) return;
    render(
      <TranslatorProvider translator={this.deps.i18n}>
        <OverlayView
          state={state}
          cursor={this.cursor === null ? null : describeElement(this.cursor)}
        />
      </TranslatorProvider>,
      this.hints,
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
      const region = this.resolutions.get(shape.id)?.region;
      if (region === undefined) continue;
      highlights.push({ rect: this.deps.dom.rectOf(region.container), role: 'container' });
      for (const group of region.groups) {
        for (const element of group.elements) {
          highlights.push({ rect: this.deps.dom.rectOf(element), role: 'selected' });
        }
      }
    }

    if (this.cursor !== null) {
      highlights.push({ rect: this.deps.dom.rectOf(this.cursor), role: 'cursor' });
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
    if (this.hints !== null) render(null, this.hints);
    this.composer?.dispose();
    this.deps.host.remove();
    // Focus goes back to where the user was on the page, not to the document body.
    if (this.pageFocus instanceof HTMLElement && this.pageFocus.isConnected) {
      this.pageFocus.focus({ preventScroll: true });
    }
    this.outcome.resolve(outcome);
  }
}

const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

const shift = (polygon: Polygon, by: Point): Point[] =>
  polygon.map((p) => ({ x: p.x + by.x, y: p.y + by.y }));

const invert = (point: Point): Point => ({ x: -point.x, y: -point.y });

const showsSameView = (snapshot: ViewportSnapshot, scroll: Point, view: Window): boolean =>
  snapshot.scroll.x === scroll.x &&
  snapshot.scroll.y === scroll.y &&
  snapshot.viewport.width === view.innerWidth &&
  snapshot.viewport.height === view.innerHeight &&
  snapshot.devicePixelRatio === view.devicePixelRatio;

/**
 * Resolves after the browser has produced a frame reflecting current DOM changes: the first
 * animation frame runs before that paint, the second one after it.
 */
const afterNextPaint = (view: Window): Promise<void> =>
  new Promise((resolve) => {
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => {
        resolve();
      });
    });
  });
