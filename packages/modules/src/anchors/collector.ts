import { defineCollector, type CaptureContext } from '@redline/capture';
import { describeElement, type DomQuery, type ResolvedRegion } from '@redline/dom';
import * as z from 'zod/mini';
import type { AnchorContext, AnchorRule, AnchorSource } from './candidate';
import { indexOccurrences, type Occurrences } from './occurrences';
import { BASE_SCORES, DEFAULT_ANCHOR_RULES } from './rules';
import { DEFAULT_ANCHOR_SOURCES } from './sources';
import type { Anchor, AnchorsData } from './types';

const optionsSchema = z.prefault(
  z.object({
    limit: z._default(z.int().check(z.positive()), 8),
    minScore: z._default(z.number(), 25),
    /** Elements inspected inside each circled element (headings, buttons, labels…). */
    maxDescendants: z._default(z.int().check(z.nonnegative()), 40),
  }),
  {},
);

/** Elements whose anchors describe the region: circled elements and what is inside them. */
const elementsOf = (dom: DomQuery, region: ResolvedRegion, maxDescendants: number): Element[] => {
  const roots =
    region.kind === 'elements'
      ? region.groups.flatMap((group) =>
          group.elements[0] === undefined ? [] : [group.elements[0]],
        )
      : [region.container, ...region.neighbors];
  const elements: Element[] = [];
  for (const root of roots) {
    elements.push(root);
    const queue = [...dom.childrenOf(root)];
    let visited = 0;
    for (
      let next = queue.shift();
      next !== undefined && visited < maxDescendants;
      next = queue.shift()
    ) {
      visited += 1;
      elements.push(next);
      queue.push(...dom.childrenOf(next));
    }
  }
  if (region.kind === 'elements') elements.push(region.container);
  return elements;
};

/**
 * Builds the anchors collector from anchor sources and scoring rules. New anchor kinds or
 * heuristics are new sources or rules; the collector itself does not change.
 */
export const createAnchorsCollector = (
  sources: readonly AnchorSource[] = DEFAULT_ANCHOR_SOURCES,
  rules: readonly AnchorRule[] = DEFAULT_ANCHOR_RULES,
) => {
  /** Counted once per capture, shared by its shapes; dropped with the capture. */
  const indexes = new WeakMap<CaptureContext, Occurrences>();
  return defineCollector({
    id: 'anchors',
    produces: 'anchors',
    level: 'shape',
    priority: 'critical',
    optionsSchema,
    collect: ({ shape, options, context: capture }) => {
      const { dom, document } = capture;
      let occurrences = indexes.get(capture);
      if (occurrences === undefined) {
        occurrences = indexOccurrences(dom, document);
        indexes.set(capture, occurrences);
      }
      const context: AnchorContext = { occurrences: (candidate) => occurrences.count(candidate) };
      const best = new Map<string, Anchor>();

      for (const element of elementsOf(dom, shape.region, options.maxDescendants)) {
        for (const candidate of sources.flatMap((source) => source.extract(element))) {
          let score = BASE_SCORES[candidate.kind];
          for (const rule of rules) {
            const delta = rule.evaluate(candidate, context);
            if (delta === 'reject') {
              score = Number.NEGATIVE_INFINITY;
              break;
            }
            score += delta;
          }
          const key = `${candidate.kind}\u0000${candidate.value}`;
          const previous = best.get(key);
          if (score >= options.minScore && (previous === undefined || previous.score < score)) {
            best.set(key, {
              kind: candidate.kind,
              value: candidate.value,
              attribute: candidate.attribute,
              element: describeElement(candidate.element),
              score,
            });
          }
        }
      }

      const anchors = [...best.values()].sort((a, b) => b.score - a.score).slice(0, options.limit);
      if (anchors.length === 0) {
        return Promise.resolve({
          status: 'not-applicable',
          reason: 'No searchable anchors in the region',
        });
      }
      const data: AnchorsData = { anchors };
      return Promise.resolve({ status: 'collected', items: [{ data }] });
    },
  });
};

export const anchorsCollector = createAnchorsCollector();
