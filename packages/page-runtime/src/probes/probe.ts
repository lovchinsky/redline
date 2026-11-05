import type { ComponentFrame, ComponentTrace } from '../protocol';

/**
 * Reads which components render an element, through hooks a framework's own build leaves on
 * DOM nodes. Internal structures differ between versions, so a probe answers `null` for
 * anything it does not recognize instead of guessing.
 */
export interface FrameworkProbe {
  readonly framework: ComponentTrace['framework'];
  trace(element: Element, view: Window): ComponentTrace | null;
}

export const MAX_COMPONENTS = 8;

/** Names a minifier produces (`e`, `Xt`, `$`): they point nowhere in the source. */
export const isMinifiedName = (name: string): boolean => /^[\w$]{1,2}$/.test(name);

/** Reads a property frameworks attach to DOM nodes, objects and functions (component types). */
export const prop = (target: unknown, key: string): unknown =>
  (typeof target === 'object' && target !== null) || typeof target === 'function'
    ? (target as Record<string, unknown>)[key]
    : undefined;

export const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * A trace worth reporting: readable names only. A production build with minified names
 * yields nothing, which the caller reports as not applicable.
 */
export const finish = (
  framework: ComponentTrace['framework'],
  version: string | null,
  mode: ComponentTrace['mode'],
  frames: readonly ComponentFrame[],
): ComponentTrace | null => {
  const readable = frames
    .filter((frame) => frame.file !== null || !isMinifiedName(frame.name))
    .slice(0, MAX_COMPONENTS);
  return readable.length === 0 ? null : { framework, version, mode, components: readable };
};

/** The element or its closest ancestor that carries `key`, crossing shadow roots. */
export const closestWith = (element: Element, has: (node: Element) => boolean): Element | null => {
  let node: Node | null = element;
  while (node !== null) {
    if (node instanceof Element && has(node)) return node;
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return null;
};
