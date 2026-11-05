import * as z from 'zod/mini';

export const RECEIVER_API_PREFIX = '/v1';
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
/** Multipart field carrying `manifest.json`; every other field name is a bundle path. */
export const MANIFEST_PART = 'manifest';

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
  z.object({ phase: z.literal('result-ready'), resultUrl: z.url() }),
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

export type Project = z.infer<typeof projectSchema>;
export type ListProjectsResponse = z.infer<typeof listProjectsResponseSchema>;
export type Question = z.infer<typeof questionSchema>;
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;
/** Response of both `POST /v1/tasks` and `GET /v1/tasks/:remoteId`. */
export type TaskStateResponse = z.infer<typeof taskStateResponseSchema>;
export type ReplyRequest = z.infer<typeof replyRequestSchema>;
