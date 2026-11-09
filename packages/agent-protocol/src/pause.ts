import * as z from 'zod/mini';
import { nonEmpty, shaSchema } from './values';

/**
 * Where a paused session stands, so that a later run goes on with it. agent-host writes it in
 * the outcome of the run that paused; the receiver keeps it with the session's files and gives
 * it back unchanged in the brief of the run that resumes the session.
 */
export const pauseSchema = z.object({
  /** The session to go on with, whose files the resuming run has at `RUN_LAYOUT.session`. */
  sessionId: nonEmpty,
  /**
   * The deferred tool call the session waits on, answered by the brief's last exchange; null
   * when the session stopped for another reason (the subscription's limit, a missing
   * credential) and goes on from where it stopped.
   */
  deferredCall: z.nullable(nonEmpty),
  /** The commit of the work so far (`RUN_OUTPUTS.work`); null when the tree is the base's. */
  workHead: z.nullable(shaSchema),
});

export type Pause = z.infer<typeof pauseSchema>;
