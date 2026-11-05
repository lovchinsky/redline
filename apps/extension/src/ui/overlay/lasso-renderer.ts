import {
  boundsOf,
  catmullRomPath,
  rectCenter,
  type BezierPath,
  type Point,
  type Polygon,
  type Rect,
} from '@redline/geometry';

export interface SceneOutline {
  readonly points: Polygon;
  /** Translation to apply, e.g. the scroll delta since the outline was drawn. */
  readonly offset: Point;
  /** Freehand strokes are smoothed; picked element boxes keep their corners. */
  readonly smooth: boolean;
  readonly closed: boolean;
}

export interface SceneHighlight {
  readonly rect: Rect;
  /** `cursor`: the element keyboard picking is on, drawn like a focus ring. */
  readonly role: 'selected' | 'container' | 'cursor';
}

export interface Scene {
  readonly outlines: readonly SceneOutline[];
  readonly highlights: readonly SceneHighlight[];
  /** Dims the page outside closed outlines to focus on what was circled. */
  readonly dimOutside: boolean;
}

/** The brand's red line, warming to orange and pink as it turns. */
const GLOW_STOPS = ['#e5484d', '#ff7a45', '#ff3d7f', '#e5484d', '#ff9a3c', '#e5484d'] as const;
const ROTATION_PERIOD_MS = 4000;

/**
 * Draws outlines with a soft, slowly rotating red glow on a full-viewport canvas.
 * Stateless between frames: every call to `render` redraws the whole scene.
 */
export class LassoRenderer {
  private readonly context: CanvasRenderingContext2D;
  private size = { width: 0, height: 0, ratio: 1 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: Window,
  ) {
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas 2D context is not available');
    this.context = context;
    this.resize();
  }

  /** Matches the backing store to the viewport and device pixel ratio. */
  resize(): void {
    const ratio = this.view.devicePixelRatio;
    const width = this.view.innerWidth;
    const height = this.view.innerHeight;
    this.size = { width, height, ratio };
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
  }

  /** `time` drives the glow rotation; pass a constant for reduced motion. */
  render(scene: Scene, time: number): void {
    const { context: ctx } = this;
    const { width, height, ratio } = this.size;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const outlines = scene.outlines
      .map((outline) => ({ outline, path: toPath2D(outline) }))
      .filter((entry): entry is { outline: SceneOutline; path: Path2D } => entry.path !== null);

    if (scene.dimOutside)
      this.dim(outlines.filter(({ outline }) => outline.closed).map(({ path }) => path));
    for (const highlight of scene.highlights) this.highlight(highlight);
    for (const { outline, path } of outlines) this.glow(path, outline, time);
  }

  private dim(holes: readonly Path2D[]): void {
    const { context: ctx } = this;
    ctx.save();
    ctx.fillStyle = 'rgb(10 12 20 / 0.16)';
    ctx.fillRect(0, 0, this.size.width, this.size.height);
    ctx.globalCompositeOperation = 'destination-out';
    for (const hole of holes) ctx.fill(hole, 'nonzero');
    ctx.restore();
  }

  private highlight({ rect, role }: SceneHighlight): void {
    const { context: ctx } = this;
    ctx.save();
    if (role === 'cursor') {
      // Two contrasting solid rings stay visible on light and dark pages alike.
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgb(255 255 255 / 0.95)';
      ctx.strokeRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e5484d';
      ctx.strokeRect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6);
      ctx.restore();
      return;
    }
    ctx.lineWidth = role === 'selected' ? 1.5 : 1;
    ctx.setLineDash(role === 'selected' ? [6, 4] : [2, 4]);
    ctx.strokeStyle = 'rgb(0 0 0 / 0.45)';
    ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.width + 1, rect.height + 1);
    ctx.strokeStyle = role === 'selected' ? 'rgb(255 255 255 / 0.95)' : 'rgb(255 255 255 / 0.6)';
    ctx.lineDashOffset = 3;
    ctx.strokeRect(rect.x - 0.5, rect.y - 0.5, rect.width + 1, rect.height + 1);
    ctx.restore();
  }

  private glow(path: Path2D, outline: SceneOutline, time: number): void {
    const { context: ctx } = this;
    const bounds = boundsOf(outline.points);
    const centre = bounds === null ? { x: 0, y: 0 } : rectCenter(bounds);
    const angle = ((time % ROTATION_PERIOD_MS) / ROTATION_PERIOD_MS) * Math.PI * 2;
    const gradient = ctx.createConicGradient(
      angle,
      centre.x + outline.offset.x,
      centre.y + outline.offset.y,
    );
    GLOW_STOPS.forEach((colour, index) => {
      gradient.addColorStop(index / (GLOW_STOPS.length - 1), colour);
    });

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = gradient;
    ctx.shadowColor = 'rgb(125 122 255 / 0.6)';

    ctx.globalAlpha = 0.35;
    ctx.shadowBlur = 24;
    ctx.lineWidth = 14;
    ctx.stroke(path);

    ctx.globalAlpha = 0.85;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 4;
    ctx.stroke(path);

    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgb(255 255 255 / 0.9)';
    ctx.stroke(path);
    ctx.restore();
  }
}

const translate = (points: Polygon, offset: Point): Point[] =>
  points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));

const toPath2D = (outline: SceneOutline): Path2D | null => {
  const points = translate(outline.points, outline.offset);
  if (points.length < 2) return null;
  const path = new Path2D();
  if (outline.smooth) {
    const bezier = catmullRomPath(points, outline.closed);
    if (bezier === null) return null;
    traceBezier(path, bezier);
  } else {
    points.forEach((point, index) => {
      if (index === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    });
    if (outline.closed) path.closePath();
  }
  return path;
};

const traceBezier = (path: Path2D, bezier: BezierPath): void => {
  path.moveTo(bezier.start.x, bezier.start.y);
  for (const { control1, control2, end } of bezier.segments) {
    path.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
  }
  if (bezier.closed) path.closePath();
};
