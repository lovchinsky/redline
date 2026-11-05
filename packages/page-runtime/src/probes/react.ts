import type { ComponentFrame } from '../protocol';
import { closestWith, finish, num, prop, str, type FrameworkProbe } from './probe';

const FIBER_KEY = /^__reactFiber\$|^__reactInternalInstance\$/;

const fiberOf = (element: Element): unknown => {
  const key = Object.keys(element).find((name) => FIBER_KEY.test(name));
  return key === undefined ? undefined : prop(element, key);
};

/** A component's name from its type: functions, classes, `forwardRef` and `memo` wrappers. */
const nameOf = (type: unknown): string | null => {
  if (typeof type === 'function') {
    return str(prop(type, 'displayName')) ?? str(prop(type, 'name'));
  }
  if (typeof type === 'object' && type !== null) {
    return (
      str(prop(type, 'displayName')) ??
      nameOf(prop(type, 'render')) ?? // forwardRef
      nameOf(prop(type, 'type')) // memo
    );
  }
  return null;
};

/**
 * React: the fiber React attaches to every host node, walked up through `return`. Development
 * builds keep `_debugOwner` (and, before React 19, `_debugSource` with the file and line).
 */
export const reactProbe: FrameworkProbe = {
  framework: 'react',
  trace(element, view) {
    const host = closestWith(element, (node) => fiberOf(node) !== undefined);
    if (host === null) return null;
    let fiber = fiberOf(host);
    const development = typeof fiber === 'object' && fiber !== null && '_debugOwner' in fiber;
    const frames: ComponentFrame[] = [];
    for (let depth = 0; fiber !== undefined && fiber !== null && depth < 200; depth += 1) {
      const type = prop(fiber, 'type');
      if (typeof type !== 'string') {
        const name = nameOf(type);
        if (name !== null) {
          const source = prop(fiber, '_debugSource');
          frames.push({
            name,
            file: str(prop(source, 'fileName')),
            line: num(prop(source, 'lineNumber')),
          });
        }
      }
      fiber = prop(fiber, 'return');
    }
    const hook = prop(view, '__REACT_DEVTOOLS_GLOBAL_HOOK__');
    const renderers = prop(hook, 'renderers');
    const renderer: unknown =
      renderers instanceof Map ? renderers.values().next().value : undefined;
    return finish(
      'react',
      str(prop(renderer, 'version')),
      development ? 'development' : 'production',
      frames,
    );
  },
};
