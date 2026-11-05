import { browser } from 'wxt/browser';
import type { CaptureShortcut } from '../../ports/capture';

/** Manifest command and context menu item that start capture on the current page. */
export const START_CAPTURE = 'start-capture';

/** The shortcut the user actually has: the default, or what they set in Chrome. */
export const browserCaptureShortcut: CaptureShortcut = {
  async current() {
    const commands = await browser.commands.getAll();
    const shortcut = commands.find((command) => command.name === START_CAPTURE)?.shortcut;
    return shortcut === undefined || shortcut === '' ? null : shortcut;
  },
};
