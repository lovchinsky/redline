import * as z from 'zod/mini';
import { ERROR_REASONS } from '../shared/errors';
import { idSchema } from '../shared/ids';
import { ProjectId } from './binding';
import { MAX_TITLE_LENGTH, TaskId, stepSchema } from './draft';
import { remoteStatusSchema } from './remote-status';

/** Why delivering or following a task failed, kept as plain data on the task. */
export const deliveryErrorSchema = z.readonly(
  z.object({
    code: z.string(),
    message: z.string(),
    /** What the user can do about it, when that is known; see `ERROR_REASONS`. */
    reason: z.optional(z.enum(ERROR_REASONS)),
  }),
);
export type DeliveryError = z.infer<typeof deliveryErrorSchema>;

export const DeliveryId = idSchema().brand<'DeliveryId'>();
export type DeliveryId = z.infer<typeof DeliveryId>;

/**
 * One send of one frozen bundle to a project. Its id is the receiver's idempotency key: every
 * attempt of the same send carries it, so a retry after a lost response finds the task the
 * first attempt created. Sending again after a definitive answer is a new delivery, with a new id.
 */
export const deliverySchema = z.readonly(
  z.object({
    id: DeliveryId,
    projectId: ProjectId,
    projectName: z.string(),
    /** Digest of the frozen bundle that is delivered, byte for byte. */
    digest: z.string(),
  }),
);
export type Delivery = z.infer<typeof deliverySchema>;

/**
 * Lifecycle of a sent task: a queued task waits in the outbox until the receiver accepts its
 * frozen bundle; a submitted task follows the receiver's status; a failed one was refused by
 * the receiver and can be sent again or reopened as a draft; a lost one was accepted, but the
 * receiver no longer knows it, so there is nothing left to follow.
 */
export const taskStateSchema = z.discriminatedUnion('kind', [
  z.readonly(
    z.object({
      kind: z.literal('queued'),
      delivery: deliverySchema,
      queuedAt: z.number(),
      attempts: z.int().check(z.nonnegative()),
      nextAttemptAt: z.number(),
      lastError: z.nullable(deliveryErrorSchema),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('submitted'),
      delivery: deliverySchema,
      remoteId: z.string().check(z.minLength(1)),
      submittedAt: z.number(),
      status: remoteStatusSchema,
      /** When the receiver last reported, and how often it is willing to be asked. */
      checkedAt: z.number(),
      pollAfterSec: z.number().check(z.positive()),
      /** When to ask the receiver again on schedule; `null` once the status is terminal. */
      nextCheckAt: z.nullable(z.number()),
      /** Checks failed in a row since the last report, and why the latest one did. */
      checkFailures: z.int().check(z.nonnegative()),
      checkError: z.nullable(deliveryErrorSchema),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('failed'),
      delivery: deliverySchema,
      error: deliveryErrorSchema,
      failedAt: z.number(),
    }),
  ),
  z.readonly(
    z.object({
      kind: z.literal('lost'),
      delivery: deliverySchema,
      remoteId: z.string().check(z.minLength(1)),
      submittedAt: z.number(),
      lostAt: z.number(),
    }),
  ),
]);
export type TaskState = z.infer<typeof taskStateSchema>;
export type TaskStateKind = TaskState['kind'];

/**
 * A task that was sent: the content the user approved, frozen, and where its delivery is. Its
 * id is the draft's: a task is a draft until it is sent, and a draft again if it is reopened.
 */
export const taskSchema = z.readonly(
  z.object({
    id: TaskId,
    title: z.nullable(z.string().check(z.minLength(1), z.maxLength(MAX_TITLE_LENGTH))),
    steps: z.readonly(z.array(stepSchema)),
    /** Revision of the draft that was sent. */
    revision: z.int().check(z.nonnegative()),
    createdAt: z.number(),
    updatedAt: z.number(),
    state: taskStateSchema,
  }),
);
export type Task = z.infer<typeof taskSchema>;
