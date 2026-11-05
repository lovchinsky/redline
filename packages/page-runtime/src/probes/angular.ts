import type { ComponentFrame } from '../protocol';
import { finish, prop, str, type FrameworkProbe } from './probe';

type NgFunction = (target: unknown) => unknown;

const ngFunction = (ng: unknown, name: string): NgFunction | null => {
  const candidate = prop(ng, name);
  return typeof candidate === 'function' ? (candidate as NgFunction) : null;
};

/**
 * Angular development mode exposes `window.ng` debugging helpers: the component owning an
 * element, and its host element, which lets the walk continue outwards.
 */
export const angularProbe: FrameworkProbe = {
  framework: 'angular',
  trace(element, view) {
    const ng = prop(view, 'ng');
    const owning = ngFunction(ng, 'getOwningComponent');
    const hostOf = ngFunction(ng, 'getHostElement');
    if (owning === null || hostOf === null) return null;
    const frames: ComponentFrame[] = [];
    let current: unknown = element;
    for (let depth = 0; depth < 50; depth += 1) {
      const component = owning(current);
      if (component === null || typeof component !== 'object') break;
      const name = str(prop(prop(component, 'constructor'), 'name'));
      if (name !== null) frames.push({ name, file: null, line: null });
      const host = hostOf(component);
      current = host instanceof Element ? host.parentElement : null;
      if (current === null) break;
    }
    const version = str(view.document.querySelector('[ng-version]')?.getAttribute('ng-version'));
    return finish('angular', version, 'development', frames);
  },
};
