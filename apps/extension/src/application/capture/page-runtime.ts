import {
  hostPermissionOf,
  ok,
  parseBindingPattern,
  type AppError,
  type Logger,
  type Result,
} from '@redline/core';
import type { ContentScriptCaller } from '@redline/rpc';
import type {
  GrantedHosts,
  PageRuntimeInjector,
  PageRuntimeRegistration,
} from '../../ports/capture';
import type { BindingStore } from '../../ports/delivery';

/** Puts the page runtime into the calling frame, when capture needs it and it is not there. */
export class InjectPageRuntime {
  constructor(private readonly injector: PageRuntimeInjector) {}

  async execute(caller: ContentScriptCaller): Promise<Result<Record<string, never>, AppError>> {
    const injected = await this.injector.inject({ tabId: caller.tabId, frameId: caller.frameId });
    return injected.ok ? ok({}) : injected;
  }
}

export interface SyncPageRuntimeDeps {
  readonly bindings: BindingStore;
  readonly granted: GrantedHosts;
  readonly registration: PageRuntimeRegistration;
  readonly logger: Logger;
}

/**
 * On bound sites the user granted access to, the page runtime starts with the page, so the
 * errors and failed requests that led to a bug report are already recorded when capture
 * starts. Elsewhere it starts with capture. Run whenever bindings or permissions change.
 */
export class SyncPageRuntime {
  constructor(private readonly deps: SyncPageRuntimeDeps) {}

  async execute(): Promise<void> {
    const { bindings, granted, registration, logger } = this.deps;
    const all = await bindings.all();
    if (!all.ok) {
      logger.error('Could not read bindings', { ...all.error });
      return;
    }
    const patterns = new Set<string>();
    for (const binding of all.value) {
      const pattern = parseBindingPattern(binding.pattern);
      if (pattern.ok) patterns.add(hostPermissionOf(pattern.value));
    }
    const allowed: string[] = [];
    for (const pattern of patterns) if (await granted.includes(pattern)) allowed.push(pattern);
    const synced = await registration.sync(allowed.sort());
    if (!synced.ok) logger.error('Could not register the page runtime', { ...synced.error });
  }
}
