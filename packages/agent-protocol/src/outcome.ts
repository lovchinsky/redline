import * as z from 'zod/mini';
import { pauseSchema } from './pause';
import { askedQuestionSchema } from './question';
import { AGENT_PROTOCOL_VERSION, shaSchema } from './values';

const text = z.string();

/**
 * The agent's account of its work, as it ends the run (the SDK's structured output). Untrusted
 * text: the receiver quotes it and never interprets it.
 */
export const agentReportSchema = z.object({
  outcome: z.enum(['change', 'no-change']),
  summary: text,
  changes: z.array(z.object({ file: text, why: text })),
  /** What the agent ran or looked at to check the change, and what it saw. */
  verification: text,
  assumptions: z.array(text),
  /** Why there is no change, when there is none. */
  explanation: text,
});

export type AgentReport = z.infer<typeof agentReportSchema>;

/** Why a run ended without a result the receiver can act on. */
export const RUN_FAILURES = [
  /** The gateway refused the run's budget: the task has spent it. */
  'budget-exhausted',
  /** The model refused the task's credential. */
  'model-access-failed',
  /** The agent ran out of turns or time, stalled, or ended without a usable report. */
  'agent-failed',
  /** The sandbox or the gateway failed: the task may run again. */
  'infra',
] as const;

export type RunFailure = (typeof RUN_FAILURES)[number];

const usageSchema = z.object({
  turns: z.int().check(z.nonnegative()),
  durationMs: z.int().check(z.nonnegative()),
  /** The SDK's own estimate; the gateway's record is the one that counts. */
  costUsd: z.number().check(z.nonnegative()),
});

export const outcomeSchema = z.object({
  protocol: z.literal(AGENT_PROTOCOL_VERSION),
  runId: z.string().check(z.minLength(1)),
  result: z.discriminatedUnion('kind', [
    /** `RUN_OUTPUTS.change` holds one commit at `CHANGE_REF`, whose parent is the base. */
    z.object({ kind: z.literal('change'), head: shaSchema, report: agentReportSchema }),
    z.object({ kind: z.literal('no-change'), explanation: text }),
    /** The agent asks the requester; the run waits for the answer in `pause`. */
    z.object({ kind: z.literal('question'), question: askedQuestionSchema }),
    /** The subscription's limit ran out; the task waits until it resets. */
    z.object({ kind: z.literal('quota-exhausted'), resetAt: z.iso.datetime() }),
    /** The requester's credential is not in the gateway (it restarted); the task waits for it. */
    z.object({ kind: z.literal('credential-missing') }),
    z.object({ kind: z.literal('failed'), reason: z.enum(RUN_FAILURES), detail: text }),
  ]),
  /**
   * How a later run goes on with this run's session: set when the run paused (`question`,
   * `quota-exhausted`, `credential-missing`) and its session can be resumed; null otherwise,
   * and then a later run starts over, told the exchanges so far.
   */
  pause: z.nullable(pauseSchema),
  usage: usageSchema,
});

export type Outcome = z.infer<typeof outcomeSchema>;
export type OutcomeResult = Outcome['result'];
export type RunUsage = z.infer<typeof usageSchema>;
