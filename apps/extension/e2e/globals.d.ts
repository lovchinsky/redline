import type { WxtBrowser } from 'wxt/browser';

declare global {
  /**
   * Extension API inside `serviceWorker.evaluate(...)` callbacks. Declared for e2e only, so
   * production code keeps getting extension APIs exclusively through adapters.
   */
  const chrome: WxtBrowser;
}
