import { startPageRuntime } from '@redline/page-runtime';

/**
 * Composition root of the page runtime, which runs in the page's MAIN world: no extension
 * APIs exist there. Started at document_start on bound sites, or injected when capture starts.
 */
export const startPageRuntimeInPage = (): void => {
  startPageRuntime(window, document.readyState === 'loading' ? 'page-load' : 'capture-start');
};
