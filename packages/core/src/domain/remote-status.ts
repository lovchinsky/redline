import * as z from 'zod/mini';

/** A question the agent asks the user before it can continue. */
export const questionSchema = z.readonly(
  z.object({
    id: z.string().check(z.minLength(1)),
    text: z.string().check(z.minLength(1)),
    /** Suggested answers; the user may still answer in their own words. */
    options: z.optional(z.readonly(z.array(z.string().check(z.minLength(1))))),
  }),
);
export type Question = z.infer<typeof questionSchema>;

/** Where the receiver is with a delivered task. Mirrors `receiver-api.v1`. */
export const remoteStatusSchema = z.discriminatedUnion('phase', [
  z.readonly(z.object({ phase: z.literal('queued') })),
  z.readonly(z.object({ phase: z.literal('working') })),
  z.readonly(z.object({ phase: z.literal('needs-input'), question: questionSchema })),
  z.readonly(
    z.object({
      phase: z.literal('result-ready'),
      // Opened for the user: a web page only, never `javascript:`, `data:` or extension pages.
      resultUrl: z.url({ protocol: /^https?$/ }),
    }),
  ),
  z.readonly(z.object({ phase: z.literal('failed'), reason: z.string() })),
  z.readonly(z.object({ phase: z.literal('closed') })),
]);
export type RemoteStatus = z.infer<typeof remoteStatusSchema>;
export type RemotePhase = RemoteStatus['phase'];

/** Phases after which the receiver will not change the task on its own: no more polling. */
export const TERMINAL_PHASES: readonly RemotePhase[] = ['result-ready', 'failed', 'closed'];

export const isTerminal = (status: RemoteStatus): boolean => TERMINAL_PHASES.includes(status.phase);
