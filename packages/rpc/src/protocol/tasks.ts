/** Sent tasks: sending a draft, and following it on the receiver. */
import {
  StepId,
  TaskId,
  bindingSchema,
  deliveryErrorSchema,
  pageRefSchema,
  remoteStatusSchema,
} from '@redline/core';
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';
import { empty, frozenBundleSchema, taskRef, projectSchema } from './shared';

/** Something went wrong, with what the user can do about it when that is known. */
const problemSchema = deliveryErrorSchema;

/**
 * Where a sent task is, in the terms a person follows it in. A view, not the stored state:
 * how delivery and following are recorded can change without the UI noticing.
 */
export const taskStatusSchema = z.discriminatedUnion('kind', [
  /** In the outbox; `retry` says why the last attempt failed and when the next one is. */
  z.object({
    kind: z.literal('sending'),
    attempts: z.int().check(z.nonnegative()),
    retry: z.nullable(z.object({ problem: problemSchema, at: z.number() })),
  }),
  /** The receiver refused it. */
  z.object({ kind: z.literal('refused'), problem: problemSchema }),
  /** With the receiver, as it last reported; `stale` when asking it again failed. */
  z.object({
    kind: z.literal('with-agent'),
    remote: remoteStatusSchema,
    stale: z.nullable(z.object({ problem: problemSchema, nextCheckAt: z.number() })),
  }),
  /** The receiver no longer knows it. */
  z.object({ kind: z.literal('lost') }),
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** What a person can do with a sent task right now; the service worker decides. */
export const TASK_ACTIONS = [
  'send-now',
  'send-again',
  'reopen',
  'refresh',
  'answer',
  'open-result',
  'delete',
] as const;

export type TaskAction = (typeof TASK_ACTIONS)[number];

export const taskViewSchema = z.object({
  id: TaskId,
  title: z.nullable(z.string()),
  firstComment: z.nullable(z.string()),
  stepCount: z.int().check(z.nonnegative()),
  updatedAt: z.number(),
  projectName: z.string(),
  status: taskStatusSchema,
  actions: z.readonly(z.array(z.enum(TASK_ACTIONS))),
  /** Nothing more will happen to it: done on the receiver, or no longer known there. */
  finished: z.boolean(),
});

export type TaskView = z.infer<typeof taskViewSchema>;

/** One step of a sent task, as the requester wrote it, with its picture in the frozen bundle. */
export const sentStepSchema = z.object({
  id: StepId,
  comment: z.string(),
  page: pageRefSchema,
  /** Path in the bundle of the first circled area's image; `null` if it has none. */
  image: z.nullable(z.string()),
});

export type SentStep = z.infer<typeof sentStepSchema>;

/**
 * What a sent task asked for: its steps and the bundle that was delivered. Frozen at sending,
 * so it is read once; where the task is now comes with `tasks.list`.
 */
export const sentTaskSchema = z.object({
  id: TaskId,
  steps: z.readonly(z.array(sentStepSchema)),
  /** `null` if the bundle can no longer be read; the steps still show without pictures. */
  bundle: z.nullable(frozenBundleSchema),
});

export type SentTask = z.infer<typeof sentTaskSchema>;

/** Where a draft would go: each site of its steps with its binding, and the project if clear. */
export const deliveryTargetSchema = z.object({
  sites: z.readonly(z.array(z.object({ origin: z.string(), binding: z.nullable(bindingSchema) }))),
  /** The one project every bound site agrees on; `null` if none is bound yet or they disagree. */
  project: z.nullable(projectSchema),
  /** Sites are bound to different projects: the draft has to be split. */
  conflict: z.boolean(),
  /**
   * Host access worth asking for when sending (it lets capture start with the page on the
   * sites being bound); the page asks, within the user's click.
   */
  hostPermissions: z.readonly(z.array(z.string())),
});

export type DeliveryTarget = z.infer<typeof deliveryTargetSchema>;

export const taskMethods = defineProtocol({
  /** Which project a draft would be delivered to, from the bindings of its sites. */
  'task.deliveryTarget': {
    request: taskRef,
    response: deliveryTargetSchema,
    callers: ['extension'],
  },
  /**
   * Queues a draft for delivery. `revision` is the draft the user saw: a newer one is refused
   * (`draft-changed`). `project` binds the draft's unbound sites to it; `null` relies on the
   * existing bindings. The frozen bundle of that revision is what gets sent.
   */
  'task.submit': {
    request: z.object({
      taskId: TaskId,
      revision: z.int().check(z.nonnegative()),
      project: z.nullable(projectSchema),
    }),
    response: empty,
    callers: ['extension'],
  },
  /** Sends a refused or waiting task again now. */
  'task.retry': { request: taskRef, response: empty, callers: ['extension'] },
  /** Turns a refused task back into the active draft. */
  'task.reopen': { request: taskRef, response: empty, callers: ['extension'] },
  /** Asks the receiver for news now, if its polling interval allows. */
  'task.refresh': { request: taskRef, response: empty, callers: ['extension'] },
  'task.reply': {
    request: z.object({
      taskId: TaskId,
      questionId: z.string().check(z.minLength(1)),
      text: z.string(),
    }),
    response: empty,
    callers: ['extension'],
  },
  /** Tasks past the draft stage, most recently changed first. */
  'tasks.list': {
    request: empty,
    response: z.object({ tasks: z.readonly(z.array(taskViewSchema)) }),
    callers: ['extension'],
  },
  /** The steps and the bundle of a sent task. */
  'tasks.get': { request: taskRef, response: sentTaskSchema, callers: ['extension'] },
  /** Deletes a sent task in any state; one the receiver accepted keeps going there. */
  'tasks.delete': { request: taskRef, response: empty, callers: ['extension'] },
});
