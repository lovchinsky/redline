import { TaskId } from '@redline/core';
import * as z from 'zod/mini';
import { defineEvents, defineProtocol } from '../runtime/define';
import { captureMethods, type tabProtocol } from './capture';
import { diagnosticsMethods } from './diagnostics';
import { draftMethods } from './drafts';
import { settingsMethods } from './settings';
import { systemMethods } from './system';
import { taskMethods } from './tasks';

export * from './capture';
export * from './diagnostics';
export * from './drafts';
export { type ProjectRef } from './shared';
export * from './settings';
export * from './tasks';

/**
 * Every request the service worker serves: the single source of truth for all contexts. Each
 * feature keeps its methods and their schemas in a module of its own.
 */
export const protocol = defineProtocol({
  ...systemMethods,
  ...captureMethods,
  ...draftMethods,
  ...taskMethods,
  ...settingsMethods,
  ...diagnosticsMethods,
});

/** Every event the service worker broadcasts to UI contexts. */
export const events = defineEvents({
  /** A draft or task was created, changed or deleted; `activeId` is the draft new steps go to. */
  'tasks.changed': z.object({ taskId: TaskId, activeId: z.nullable(TaskId) }),
  /** Receiver settings or bindings changed. */
  'settings.changed': z.object({}),
  'diagnostics.changed': z.object({}),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
export type TabProtocol = typeof tabProtocol;
