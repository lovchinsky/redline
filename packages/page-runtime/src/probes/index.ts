import type { ComponentTrace } from '../protocol';
import { angularProbe } from './angular';
import type { FrameworkProbe } from './probe';
import { reactProbe } from './react';
import { svelteProbe } from './svelte';
import { vueProbe } from './vue';

export const PROBES: readonly FrameworkProbe[] = [reactProbe, vueProbe, svelteProbe, angularProbe];

/**
 * The first probe that recognizes the element. A probe that throws is treated as not
 * recognizing it: framework internals are not ours to rely on.
 */
export const traceComponents = (
  element: Element,
  view: Window,
  probes: readonly FrameworkProbe[] = PROBES,
): ComponentTrace | null => {
  for (const probe of probes) {
    try {
      const trace = probe.trace(element, view);
      if (trace !== null) return trace;
    } catch {
      // Unexpected internals: not this framework, or a version we do not know.
    }
  }
  return null;
};
