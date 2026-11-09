import * as z from 'zod/mini';

/**
 * One line of `RUN_OUTPUTS.events`: the run's journal and its sign of life. Short, and free of
 * secrets and of the agent's full output (the session transcript has that).
 */
export const runEventSchema = z.discriminatedUnion('kind', [
  /** `resumed`: the session goes on with a paused one; otherwise it is new. */
  z.object({
    kind: z.literal('started'),
    at: z.iso.datetime(),
    model: z.string(),
    resumed: z.boolean(),
  }),
  z.object({ kind: z.literal('turn'), at: z.iso.datetime(), text: z.string() }),
  z.object({ kind: z.literal('tool'), at: z.iso.datetime(), tool: z.string(), target: z.string() }),
  z.object({
    kind: z.literal('denied'),
    at: z.iso.datetime(),
    tool: z.string(),
    reason: z.string(),
  }),
  z.object({ kind: z.literal('ended'), at: z.iso.datetime(), result: z.string() }),
]);

export type RunEvent = z.infer<typeof runEventSchema>;

/** Text of an event is cut to this many characters: the journal is a trace, not a transcript. */
export const EVENT_TEXT_LIMIT = 500;
