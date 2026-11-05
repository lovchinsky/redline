import { defineCollector } from '@redline/capture';
import { projectRelative } from '@redline/core';
import { describeElement, representativeElements } from '@redline/dom';
import * as z from 'zod/mini';
import { compareSpecificity, specificityOf, splitSelectors, type Specificity } from './specificity';
import type { CssRulesData, MatchedRule, RuleSource } from './types';

const MAX_DECLARATIONS = 400;

/** Selectors that match nearly everything say nothing about the circled element. */
const UNSPECIFIC = new Set(['*', 'html', 'body', ':root', '*::before', '*::after']);

const sourceOf = (sheet: CSSStyleSheet): RuleSource => {
  const owner = sheet.ownerNode;
  if (owner === null) return { kind: 'constructed' };
  const devId = owner instanceof HTMLElement ? owner.dataset['viteDevId'] : undefined;
  if (devId !== undefined) return { kind: 'dev-module', path: projectRelative(devId) };
  if (sheet.href !== null) return { kind: 'stylesheet', path: new URL(sheet.href).pathname };
  return { kind: 'inline-style-element' };
};

const matching = (element: Element, selectorText: string): string[] =>
  splitSelectors(selectorText).filter((selector) => {
    if (UNSPECIFIC.has(selector)) return false;
    try {
      return element.matches(selector);
    } catch {
      return false; // pseudo-elements, nesting `&`, or syntax this engine does not know
    }
  });

/** A matched rule with what decides its place in the cascade (as far as it is weighed). */
interface Found {
  readonly rule: MatchedRule;
  readonly specificity: Specificity;
}

interface Walk {
  readonly element: Element;
  readonly view: Window;
  readonly source: RuleSource;
  readonly found: Found[];
}

const walk = (rules: CSSRuleList, conditions: readonly string[], context: Walk): void => {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = matching(context.element, rule.selectorText);
      if (selectors.length > 0 && rule.style.length > 0) {
        const declarations = rule.style.cssText;
        context.found.push({
          rule: {
            selector: selectors.join(', '),
            declarations:
              declarations.length > MAX_DECLARATIONS
                ? `${declarations.slice(0, MAX_DECLARATIONS)}…`
                : declarations,
            source: context.source,
            conditions,
          },
          // A rule applies with its most specific selector that matches.
          specificity: selectors
            .map(specificityOf)
            .reduce((best, next) => (compareSpecificity(next, best) > 0 ? next : best)),
        });
      }
    } else if (rule instanceof CSSMediaRule) {
      if (context.view.matchMedia(rule.conditionText).matches) {
        walk(rule.cssRules, [...conditions, `@media ${rule.conditionText}`], context);
      }
    } else if (rule instanceof CSSSupportsRule) {
      if (CSS.supports(rule.conditionText)) {
        walk(rule.cssRules, [...conditions, `@supports ${rule.conditionText}`], context);
      }
    } else if (rule instanceof CSSLayerBlockRule) {
      walk(rule.cssRules, [...conditions, `@layer ${rule.name}`], context);
    }
  }
};

/** The element's own stylesheets: its document's, plus a shadow root's adopted ones. */
const sheetsFor = (element: Element): CSSStyleSheet[] => {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) {
    return [...Array.from(root.styleSheets), ...root.adoptedStyleSheets];
  }
  return [];
};

const optionsSchema = z.prefault(
  z.object({
    maxElements: z._default(z.int().check(z.positive()), 2),
    maxRulesPerElement: z._default(z.int().check(z.positive()), 8),
  }),
  {},
);

/**
 * The CSS rules that style the circled elements, with the file they come from. On a dev server
 * that file is the stylesheet to edit; elsewhere selectors still point the way. Cross-origin
 * stylesheets are counted, never worked around.
 */
export const cssRulesCollector = defineCollector({
  id: 'css-rules',
  produces: 'css-rules',
  level: 'shape',
  priority: 'high',
  optionsSchema,
  collect: ({ shape, options, context: { document } }) => {
    const view = document.defaultView;
    if (view === null) {
      return Promise.resolve({ status: 'not-applicable', reason: 'Detached document' });
    }
    // Counted once per sheet, however many elements look at it.
    const unreadable = new Set<CSSStyleSheet>();
    const elements = representativeElements(shape.region, options.maxElements).map((element) => {
      const found: Found[] = [];
      for (const sheet of sheetsFor(element)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          unreadable.add(sheet);
          continue;
        }
        walk(rules, [], { element, view, source: sourceOf(sheet), found });
      }
      // Weakest first, as the cascade weighs them: specificity, then order of appearance
      // (a stable sort keeps it). Layers and !important are not weighed.
      const ranked = found
        .toSorted((a, b) => compareSpecificity(a.specificity, b.specificity))
        .map((entry) => entry.rule);
      const inline = element.getAttribute('style');
      if (inline !== null && inline.trim() !== '') {
        // Beats every selector.
        ranked.push({
          selector: 'style=""',
          declarations: inline.trim().slice(0, MAX_DECLARATIONS),
          source: { kind: 'style-attribute' },
          conditions: [],
        });
      }
      // The strongest rules decide what the element looks like; keep those when there are many.
      return { label: describeElement(element), rules: ranked.slice(-options.maxRulesPerElement) };
    });

    const data: CssRulesData = { elements, unreadableSheets: unreadable.size };
    return Promise.resolve(
      elements.every((element) => element.rules.length === 0) && unreadable.size === 0
        ? { status: 'not-applicable', reason: 'No author CSS rules match' }
        : { status: 'collected', items: [{ data }] },
    );
  },
});
