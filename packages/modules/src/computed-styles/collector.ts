import { defineCollector } from '@redline/capture';
import { describeElement, representativeElements } from '@redline/dom';
import * as z from 'zod/mini';
import { STYLE_GROUPS, type ComputedStylesData, type StyleGroup } from './types';

/** `null`: always reported. `string`: reported only when the value differs from it. */
type Initial = string | null;

const GROUPS: Readonly<Record<StyleGroup, Readonly<Record<string, Initial>>>> = {
  box: {
    width: null,
    height: null,
    'box-sizing': 'content-box',
    padding: '0px',
    margin: '0px',
  },
  typography: {
    'font-family': '',
    'font-size': '',
    'font-weight': '400',
    'font-style': 'normal',
    'line-height': 'normal',
    'letter-spacing': 'normal',
    color: '',
    'text-align': 'start',
    'text-transform': 'none',
    'text-decoration-line': 'none',
    'white-space': 'normal',
  },
  visual: {
    'background-color': 'rgba(0, 0, 0, 0)',
    'background-image': 'none',
    border: '',
    'border-radius': '0px',
    'box-shadow': 'none',
    opacity: '1',
    cursor: 'auto',
  },
  position: {
    display: null,
    position: 'static',
    'z-index': 'auto',
    flex: '0 1 auto',
    'align-self': 'auto',
    order: '0',
  },
};

/** Inherited by default: a value equal to the parent's says nothing about this element. */
const INHERITED = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'color',
  'text-align',
  'text-transform',
  'white-space',
  'cursor',
]);

/** Shorthands Chrome cannot serialize (e.g. sides differ) come back empty: then omitted. */
const BORDERLESS = /^0px none\b/;

const optionsSchema = z.prefault(
  z.object({
    groups: z._default(z.readonly(z.array(z.enum(STYLE_GROUPS))), [...STYLE_GROUPS]),
    maxElements: z._default(z.int().check(z.positive()), 3),
  }),
  {},
);

const stylesOf = (
  element: Element,
  view: Window,
  groups: readonly StyleGroup[],
): Record<string, string> => {
  const style = view.getComputedStyle(element);
  const parent =
    element.parentElement === null ? null : view.getComputedStyle(element.parentElement);
  const styles: Record<string, string> = {};
  for (const group of groups) {
    for (const [property, initial] of Object.entries(GROUPS[group])) {
      const value = style.getPropertyValue(property).trim();
      if (value === '' || value === initial) continue;
      if (property === 'border' && BORDERLESS.test(value)) continue;
      if (INHERITED.has(property) && parent?.getPropertyValue(property).trim() === value) continue;
      styles[property] = value;
    }
  }
  return styles;
};

/**
 * Computed styles of the circled elements that say something about them: values left at their
 * initial value or inherited unchanged from the parent are dropped.
 */
export const computedStylesCollector = defineCollector({
  id: 'computed-styles',
  produces: 'computed-styles',
  level: 'shape',
  priority: 'normal',
  optionsSchema,
  collect: ({ shape, options, context: { document } }) => {
    const view = document.defaultView;
    if (view === null) {
      return Promise.resolve({ status: 'not-applicable', reason: 'Detached document' });
    }
    const data: ComputedStylesData = {
      elements: representativeElements(shape.region, options.maxElements).map((element) => ({
        label: describeElement(element),
        styles: stylesOf(element, view, options.groups),
      })),
    };
    return Promise.resolve({ status: 'collected', items: [{ data }] });
  },
});
