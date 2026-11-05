/** Where tasks go: the receiver, its projects, and which sites belong to which. */
import { bindingSchema } from '@redline/core';
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';
import { empty, projectSchema } from './shared';

export const receiverViewSchema = z.object({
  baseUrl: z.string(),
  hasToken: z.boolean(),
});

export type ReceiverView = z.infer<typeof receiverViewSchema>;

export const settingsMethods = defineProtocol({
  'receiver.get': {
    request: empty,
    response: z.object({ receiver: z.nullable(receiverViewSchema) }),
    callers: ['extension'],
  },
  /** `token` omitted keeps the stored one; `null` removes it. */
  'receiver.configure': {
    request: z.object({ baseUrl: z.string(), token: z.optional(z.nullable(z.string())) }),
    response: empty,
    callers: ['extension'],
  },
  'receiver.clear': { request: empty, response: empty, callers: ['extension'] },
  'projects.list': {
    request: empty,
    response: z.object({ projects: z.readonly(z.array(projectSchema)) }),
    callers: ['extension'],
  },
  'bindings.list': {
    request: empty,
    response: z.object({ bindings: z.readonly(z.array(bindingSchema)) }),
    callers: ['extension'],
  },
  /** Binds a site pattern to a project; responds with the pattern in canonical form. */
  'bindings.set': {
    request: z.object({ pattern: z.string(), project: projectSchema }),
    response: z.object({ pattern: z.string() }),
    callers: ['extension'],
  },
  'bindings.remove': {
    request: z.object({ pattern: z.string() }),
    response: empty,
    callers: ['extension'],
  },
});
