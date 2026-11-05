import { defineCollector } from '@redline/capture';
import { projectRelative } from '@redline/core';
import { describeElement, representativeElements } from '@redline/dom';
import * as z from 'zod/mini';
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

/** Splits a selector list at top-level commas (not inside `:is(…)` or attribute values). */
const splitSelectors = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((part) => part !== '');
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

interface Walk {
  readonly element: Element;
  readonly view: Window;
  readonly source: RuleSource;
  readonly found: MatchedRule[];
}

const walk = (rules: CSSRuleList, conditions: readonly string[], context: Walk): void => {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const selectors = matching(context.element, rule.selectorText);
      if (selectors.length > 0 && rule.style.length > 0) {
        const declarations = rule.style.cssText;
        context.found.push({
          selector: selectors.join(', '),
          declarations:
            declarations.length > MAX_DECLARATIONS
              ? `${declarations.slice(0, MAX_DECLARATIONS)}…`
              : declarations,
          source: context.source,
          conditions,
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
    let unreadable = 0;
    const elements = representativeElements(shape.region, options.maxElements).map((element) => {
      const found: MatchedRule[] = [];
      for (const sheet of sheetsFor(element)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          unreadable += 1;
          continue;
        }
        walk(rules, [], { element, view, source: sourceOf(sheet), found });
      }
      const inline = element.getAttribute('style');
      if (inline !== null && inline.trim() !== '') {
        found.push({
          selector: 'style=""',
          declarations: inline.trim().slice(0, MAX_DECLARATIONS),
          source: { kind: 'style-attribute' },
          conditions: [],
        });
      }
      // The last rules win the cascade; keep those when there are too many.
      return { label: describeElement(element), rules: found.slice(-options.maxRulesPerElement) };
    });

    const data: CssRulesData = { elements, unreadableSheets: unreadable };
    return Promise.resolve(
      elements.every((element) => element.rules.length === 0) && unreadable === 0
        ? { status: 'not-applicable', reason: 'No author CSS rules match' }
        : { status: 'collected', items: [{ data }] },
    );
  },
});
