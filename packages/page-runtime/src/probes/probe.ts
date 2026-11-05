import { LIMITS, clip, type ComponentFrame, type ComponentTrace } from '../protocol';

/**
 * Reads which components render an element, through hooks a framework's own build leaves on
 * DOM nodes. Internal structures differ between versions, so a probe answers `null` for
 * anything it does not recognize instead of guessing.
 */
export interface FrameworkProbe {
  readonly framework: ComponentTrace['framework'];
  trace(element: Element, view: Window): ProbeResult | null;
}

/** A trace, and the node the framework's innermost component was read from. */
export interface ProbeResult {
  readonly trace: ComponentTrace;
  readonly host: Element;
}

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
  host: Element,
  framework: ComponentTrace['framework'],
  version: string | null,
  mode: ComponentTrace['mode'],
  frames: readonly ComponentFrame[],
): ProbeResult | null => {
  const readable = frames
    .filter((frame) => frame.file !== null || !isMinifiedName(frame.name))
    .slice(0, LIMITS.components)
    .map(({ name, file, line }) => ({
      name: clip(name, LIMITS.componentName),
      file: file === null ? null : clip(file, LIMITS.url),
      line,
    }));
  const shortVersion = version === null ? null : clip(version, LIMITS.version);
  return readable.length === 0
    ? null
    : { host, trace: { framework, version: shortVersion, mode, components: readable } };
};

/** The flat-tree parent: across shadow roots to their host. */
export const parentOf = (node: Node): Node | null =>
  node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);

/** The element or its closest ancestor that carries `key`, crossing shadow roots. */
export const closestWith = (element: Element, has: (node: Element) => boolean): Element | null => {
  for (let node: Node | null = element; node !== null; node = parentOf(node)) {
    if (node instanceof Element && has(node)) return node;
  }
  return null;
};
