import { browser } from 'wxt/browser';
import type { HostAccess, Navigation } from '../../ports/delivery';

export const browserHostAccess: HostAccess = {
  async request(matchPatterns) {
    if (matchPatterns.length === 0) return true;
    try {
      return await browser.permissions.request({ origins: [...matchPatterns] });
    } catch {
      // Not in the optional list, or no user gesture: treated as not granted.
      return false;
    }
  },
};

export const browserNavigation: Navigation = {
  openSettings: () => browser.runtime.openOptionsPage(),
  async openUrl(url) {
    await browser.tabs.create({ url });
  },
};
