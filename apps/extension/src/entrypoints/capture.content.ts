import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContentRuntime } from '../composition/content.container';

/** Injected on demand by the service worker (keyboard shortcut, context menu); never declared. */
export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'manual',
  main(ctx) {
    startContentRuntime(ctx);
  },
});
