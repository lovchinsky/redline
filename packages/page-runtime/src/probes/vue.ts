import type { ComponentFrame } from '../protocol';
import { closestWith, finish, prop, str, type FrameworkProbe } from './probe';

/** Vue 3 SFCs carry `__name` (from the file) and, in development, `__file`. */
const vue3Frame = (instance: unknown): ComponentFrame | null => {
  const type = prop(instance, 'type');
  const file = str(prop(type, '__file'));
  const name =
    str(prop(type, 'name')) ??
    str(prop(type, '__name')) ??
    (file === null
      ? null
      : (file
          .split('/')
          .pop()
          ?.replace(/\.vue$/, '') ?? null));
  return name === null ? null : { name, file, line: null };
};

const vue3 = (element: Element): ComponentFrame[] | null => {
  const host = closestWith(element, (node) => prop(node, '__vueParentComponent') !== undefined);
  if (host === null) return null;
  const frames: ComponentFrame[] = [];
  let instance = prop(host, '__vueParentComponent');
  for (let depth = 0; instance !== undefined && instance !== null && depth < 100; depth += 1) {
    const frame = vue3Frame(instance);
    if (frame !== null) frames.push(frame);
    instance = prop(instance, 'parent');
  }
  return frames;
};

const vue2 = (element: Element): ComponentFrame[] | null => {
  const host = closestWith(element, (node) => prop(node, '__vue__') !== undefined);
  if (host === null) return null;
  const frames: ComponentFrame[] = [];
  let vm = prop(host, '__vue__');
  for (let depth = 0; vm !== undefined && vm !== null && depth < 100; depth += 1) {
    const options = prop(vm, '$options');
    const file = str(prop(options, '__file'));
    const name = str(prop(options, 'name')) ?? str(prop(options, '_componentTag'));
    if (name !== null) frames.push({ name, file, line: null });
    vm = prop(vm, '$parent');
  }
  return frames;
};

const versionOf = (element: Element): string | null => {
  const root = closestWith(element, (node) => prop(node, '__vue_app__') !== undefined);
  return str(prop(prop(root, '__vue_app__'), 'version'));
};

/** Vue 3 (`__vueParentComponent`) and Vue 2 (`__vue__`) component instances on DOM nodes. */
export const vueProbe: FrameworkProbe = {
  framework: 'vue',
  trace(element) {
    const frames = vue3(element) ?? vue2(element);
    if (frames === null) return null;
    const development = frames.some((frame) => frame.file !== null);
    return finish('vue', versionOf(element), development ? 'development' : 'unknown', frames);
  },
};
