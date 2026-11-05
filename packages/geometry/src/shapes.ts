import type { Polygon, Rect } from './types';

/** Polygon approximating the ellipse inscribed in `rect`. */
export const ellipsePolygon = (rect: Rect, vertices = 48): Polygon => {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return Array.from({ length: vertices }, (_, i) => {
    const angle = (2 * Math.PI * i) / vertices;
    return {
      x: cx + (rect.width / 2) * Math.cos(angle),
      y: cy + (rect.height / 2) * Math.sin(angle),
    };
  });
};

export const rectPolygon = (rect: Rect): Polygon => [
  { x: rect.x, y: rect.y },
  { x: rect.x + rect.width, y: rect.y },
  { x: rect.x + rect.width, y: rect.y + rect.height },
  { x: rect.x, y: rect.y + rect.height },
];
