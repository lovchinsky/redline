import { defineCollector } from '@redline/capture';
import { projectRelative } from '@redline/core';
import { describeElement, representativeElements } from '@redline/dom';
import * as z from 'zod/mini';
import type { FrameworkData } from './types';

/**
 * Which components render the circled element, read in the page's own JavaScript world.
 * Most useful on a dev server, where builds keep component names and often files. A production
 * build, an unknown framework or a page that blocks the runtime is not a failure: the step
 * just has no component trace, and anchors carry the search.
 */
export const frameworkCollector = defineCollector({
  id: 'framework',
  produces: 'framework',
  level: 'shape',
  priority: 'high',
  optionsSchema: z.undefined(),
  collect: async ({ shape, context: { pageRuntime } }) => {
    const [element] = representativeElements(shape.region, 1);
    if (element === undefined) return { status: 'not-applicable', reason: 'Nothing circled' };
    const trace = await pageRuntime.componentTrace(element);
    if (!trace.ok) return { status: 'unavailable', reason: trace.error.message };
    if (trace.value === null) {
      return { status: 'not-applicable', reason: 'No readable framework components' };
    }
    const data: FrameworkData = {
      framework: trace.value.framework,
      version: trace.value.version,
      mode: trace.value.mode,
      element: describeElement(element),
      components: trace.value.components.map((component) => ({
        name: component.name,
        file: component.file === null ? null : projectRelative(component.file),
        line: component.line,
      })),
    };
    return { status: 'collected', items: [{ data }] };
  },
});
