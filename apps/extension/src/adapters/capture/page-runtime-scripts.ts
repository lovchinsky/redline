import { appError, err, okVoid, toAppError } from '@redline/core';
import { browser } from 'wxt/browser';
import type {
  GrantedHosts,
  PageRuntimeInjector,
  PageRuntimeRegistration,
} from '../../ports/capture';

export const PAGE_RUNTIME_SCRIPT = '/page-runtime.js';
const REGISTRATION_ID = 'redline-page-runtime';

/** Executes the page runtime in a frame's MAIN world (needs activeTab or host access). */
export const scriptingPageRuntimeInjector: PageRuntimeInjector = {
  async inject({ tabId, frameId }) {
    try {
      await browser.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        files: [PAGE_RUNTIME_SCRIPT],
        world: 'MAIN',
      });
      return okVoid();
    } catch (cause) {
      return err(
        appError('bridge-unavailable', 'The page runtime cannot run in this frame', {
          tabId,
          cause: toAppError(cause).message,
        }),
      );
    }
  },
};

/** A registered MAIN-world content script, kept equal to the requested set of sites. */
export const scriptingPageRuntimeRegistration: PageRuntimeRegistration = {
  async sync(matchPatterns) {
    try {
      const existing = await browser.scripting.getRegisteredContentScripts({
        ids: [REGISTRATION_ID],
      });
      if (matchPatterns.length === 0) {
        if (existing.length > 0) {
          await browser.scripting.unregisterContentScripts({ ids: [REGISTRATION_ID] });
        }
        return okVoid();
      }
      const script = {
        id: REGISTRATION_ID,
        js: [PAGE_RUNTIME_SCRIPT],
        matches: [...matchPatterns],
        runAt: 'document_start' as const,
        world: 'MAIN' as const,
        allFrames: false,
        persistAcrossSessions: true,
      };
      if (existing.length > 0) await browser.scripting.updateContentScripts([script]);
      else await browser.scripting.registerContentScripts([script]);
      return okVoid();
    } catch (cause) {
      return err(toAppError(cause, 'internal'));
    }
  },
};

export const browserGrantedHosts: GrantedHosts = {
  async includes(matchPattern) {
    try {
      return await browser.permissions.contains({ origins: [matchPattern] });
    } catch {
      return false;
    }
  },
};
