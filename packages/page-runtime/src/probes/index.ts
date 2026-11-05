import type { ComponentTrace } from '../protocol';
import { angularProbe } from './angular';
import { parentOf, type FrameworkProbe, type ProbeResult } from './probe';
import { reactProbe } from './react';
import { svelteProbe } from './svelte';
import { vueProbe } from './vue';

export const PROBES: readonly FrameworkProbe[] = [reactProbe, vueProbe, svelteProbe, angularProbe];

/**
 * The components of the framework that renders the element: when several recognize it (a Vue
 * widget inside a React app), the one whose component sits closest to the element. A probe
 * that throws is treated as not recognizing it: framework internals are not ours to rely on.
 */
export const traceComponents = (
  element: Element,
  view: Window,
  probes: readonly FrameworkProbe[] = PROBES,
): ComponentTrace | null => {
  const found: ProbeResult[] = [];
  for (const probe of probes) {
    try {
      const result = probe.trace(element, view);
      if (result !== null) found.push(result);
    } catch {
      // Unexpected internals: not this framework, or a version we do not know.
    }
  }
  if (found.length <= 1) return found[0]?.trace ?? null;
  for (let node: Node | null = element; node !== null; node = parentOf(node)) {
    const nearest = found.find((result) => result.host === node);
    if (nearest !== undefined) return nearest.trace;
  }
  return found[0]?.trace ?? null;
};
