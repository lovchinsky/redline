import { defineCollector } from '@redline/capture';
import { describeElement } from '@redline/dom';
import * as z from 'zod/mini';
import type { LayoutData } from './types';

/** Properties that decide how a container places its children, with their initial values. */
const LAYOUT_PROPERTIES: Readonly<Record<string, string | null>> = {
  display: null, // always reported
  position: 'static',
  'flex-direction': 'row',
  'flex-wrap': 'nowrap',
  'justify-content': 'normal',
  'align-items': 'normal',
  'align-content': 'normal',
  gap: 'normal',
  'grid-template-columns': 'none',
  'grid-template-rows': 'none',
  'grid-auto-flow': 'row',
  overflow: 'visible',
};

const FLEX_OR_GRID_ONLY = new Set([
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'align-content',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
]);

const optionsSchema = z.prefault(
  z.object({ maxChildren: z._default(z.int().check(z.positive()), 12) }),
  {},
);

const layoutStyles = (style: CSSStyleDeclaration): Record<string, string> => {
  const display = style.getPropertyValue('display');
  const isFlexOrGrid = /flex|grid/.test(display);
  const styles: Record<string, string> = {};
  for (const [property, initial] of Object.entries(LAYOUT_PROPERTIES)) {
    if (FLEX_OR_GRID_ONLY.has(property) && !isFlexOrGrid) continue;
    const value = style.getPropertyValue(property);
    if (value !== '' && value !== initial) styles[property] = value;
  }
  return styles;
};

/** Media query conditions matching right now; cross-origin stylesheets cannot be read. */
const activeMediaQueries = (document: Document, view: Window): string[] => {
  const conditions = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet: its rules are not readable by design
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule && view.matchMedia(rule.conditionText).matches) {
        conditions.add(rule.conditionText);
      }
    }
  }
  return [...conditions].slice(0, 6);
};

/** How the region's container lays out its children, and where the circled ones sit. */
export const layoutCollector = defineCollector({
  id: 'layout',
  produces: 'layout',
  level: 'shape',
  priority: 'normal',
  optionsSchema,
  collect: ({ shape, options, context: { dom, document } }) => {
    const view = document.defaultView;
    if (view === null)
      return Promise.resolve({ status: 'not-applicable', reason: 'Detached document' });
    const { container } = shape.region;
    const origin = dom.rectOf(container);
    const circled = new Set(shape.region.groups.flatMap((group) => group.elements));
    const children = dom.childrenOf(container).filter((child) => dom.isVisible(child));

    const data: LayoutData = {
      container: describeElement(container),
      styles: layoutStyles(view.getComputedStyle(container)),
      children: children.slice(0, options.maxChildren).map((child) => {
        const rect = dom.rectOf(child);
        return {
          label: describeElement(child),
          box: {
            x: rect.x - origin.x,
            y: rect.y - origin.y,
            width: rect.width,
            height: rect.height,
          },
          circled: circled.has(child),
        };
      }),
      childCount: children.length,
      activeMediaQueries: activeMediaQueries(document, view),
    };
    return Promise.resolve({ status: 'collected', items: [{ data }] });
  },
});
