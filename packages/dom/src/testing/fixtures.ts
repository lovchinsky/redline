import { boundsOf, ellipsePolygon, inflateRect, type Polygon, type Rect } from '@redline/geometry';

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.4 sans-serif; }
`;

/** Replaces the test document's body with the fixture and returns a query helper. */
export const mount = (html: string, css = '') => {
  document.head.querySelector('style[data-fixture]')?.remove();
  const style = document.createElement('style');
  style.dataset['fixture'] = '';
  style.textContent = BASE_STYLE + css;
  document.head.append(style);
  document.body.innerHTML = html;
  window.scrollTo(0, 0);
  return {
    get: (selector: string): Element => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`Fixture has no element matching ${selector}`);
      return element;
    },
  };
};

const unionRect = (elements: readonly Element[]): Rect => {
  const corners = elements.flatMap((element) => {
    const r = element.getBoundingClientRect();
    return [
      { x: r.left, y: r.top },
      { x: r.right, y: r.bottom },
    ];
  });
  const bounds = boundsOf(corners);
  if (bounds === null) throw new Error('No elements to circle');
  return bounds;
};

/** Ellipse passing through the corners of the elements' bounding box, plus `slack` px. */
export const circleAround = (elements: readonly Element[], slack = 8): Polygon => {
  const rect = inflateRect(unionRect(elements), slack);
  const grow = Math.SQRT2;
  return ellipsePolygon({
    x: rect.x - (rect.width * (grow - 1)) / 2,
    y: rect.y - (rect.height * (grow - 1)) / 2,
    width: rect.width * grow,
    height: rect.height * grow,
  });
};

/** Ellipse inscribed in the elements' bounding box: a tight lasso that clips the corners. */
export const tightCircle = (elements: readonly Element[]): Polygon =>
  ellipsePolygon(unionRect(elements));

export const ellipseIn = (rect: Rect): Polygon => ellipsePolygon(rect);
