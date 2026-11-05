import type { ComponentFrame } from '../protocol';
import { finish, num, prop, str, type FrameworkProbe } from './probe';

/**
 * Svelte development builds tag elements with `__svelte_meta.loc`: the component file and the
 * line of the element in it. Each ancestor from a different file is an enclosing component.
 */
export const svelteProbe: FrameworkProbe = {
  framework: 'svelte',
  trace(element) {
    const frames: ComponentFrame[] = [];
    let host: Element | null = null;
    let node: Element | null = element;
    let lastFile: string | null = null;
    for (let depth = 0; node !== null && depth < 200; depth += 1) {
      const location = prop(prop(node, '__svelte_meta'), 'loc');
      const file = str(prop(location, 'file'));
      if (file !== null && file !== lastFile) {
        const name =
          file
            .split('/')
            .pop()
            ?.replace(/\.svelte$/, '') ?? file;
        frames.push({ name, file, line: num(prop(location, 'line')) });
        host ??= node;
        lastFile = file;
      }
      node = node.parentElement;
    }
    return host === null ? null : finish(host, 'svelte', null, 'development', frames);
  },
};
