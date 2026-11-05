import * as z from 'zod/mini';

export const RECEIVER_API_PREFIX = '/v1';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** Multipart field carrying `manifest.json`; every other field name is a bundle path. */
export const MANIFEST_PART = 'manifest';
/**
 * Multipart field naming the receiver project. Delivery metadata, deliberately not part of the
 * bundle: a bundle describes what to change and stays the same whichever project receives it.
 */
export const PROJECT_PART = 'projectId';

export const receiverRoutes = {
  listProjects: () => `${RECEIVER_API_PREFIX}/projects`,
  submitTask: () => `${RECEIVER_API_PREFIX}/tasks`,
  getTask: (remoteId: string) => `${RECEIVER_API_PREFIX}/tasks/${encodeURIComponent(remoteId)}`,
  replyToTask: (remoteId: string) =>
    `${RECEIVER_API_PREFIX}/tasks/${encodeURIComponent(remoteId)}/replies`,
} as const;

export const projectSchema = z.object({
  id: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
});

export const listProjectsResponseSchema = z.object({ projects: z.array(projectSchema) });

export const questionSchema = z.object({
  id: z.string().check(z.minLength(1)),
  text: z.string().check(z.minLength(1)),
  options: z.optional(z.array(z.string().check(z.minLength(1)))),
});

export const remoteStatusSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('queued') }),
  z.object({ phase: z.literal('working') }),
  z.object({ phase: z.literal('needs-input'), question: questionSchema }),
  z.object({
    phase: z.literal('result-ready'),
    /** A web page (http or https) the user opens to see the result. */
    resultUrl: z.url({ protocol: /^https?$/ }),
  }),
  z.object({ phase: z.literal('failed'), reason: z.string() }),
  z.object({ phase: z.literal('closed') }),
]);

const pollAfterSecSchema = z.int().check(z.positive());

export const taskStateResponseSchema = z.object({
  remoteId: z.string().check(z.minLength(1)),
  status: remoteStatusSchema,
  pollAfterSec: pollAfterSecSchema,
});

export const replyRequestSchema = z.object({
  questionId: z.string().check(z.minLength(1)),
  text: z.string().check(z.minLength(1)),
});

/**
 * Body of an error response. `message` is for people; `code` is for the extension, which acts
 * on the codes below and treats any other (or a body it cannot read) by the HTTP status alone.
 */
export const ERROR_CODES = {
  /** `404` for a task the receiver does not know, or no longer keeps: it stops being followed. */
  unknownTask: 'unknown-task',
} as const;

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string().check(z.minLength(1)), message: z.string() }),
});

export type Project = z.infer<typeof projectSchema>;
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
export type Question = z.infer<typeof questionSchema>;
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;
/**
 * Response of `POST /v1/tasks`, `GET /v1/tasks/:remoteId` and `POST /v1/tasks/:remoteId/replies`.
 *
 * `POST /v1/tasks` with an `Idempotency-Key` already seen returns the existing task. A key
 * stands for one delivery of one bundle: retries of that delivery repeat it, and the extension
 * sends a new key whenever it sends a bundle anew.
 *
 * `POST /v1/tasks/:remoteId/replies` answering a question already answered with the same text
 * returns the current state, so a reply repeated after a lost response is harmless.
 */
export type TaskStateResponse = z.infer<typeof taskStateResponseSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
