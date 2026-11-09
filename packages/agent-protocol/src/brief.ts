import * as z from 'zod/mini';
import { pauseSchema } from './pause';
import { AGENT_PROTOCOL_VERSION, nonEmpty, shaSchema } from './values';

const text = z.string();
const count = z.int().check(z.nonnegative());
const positive = z.int().check(z.positive());

/** One step of the task, as the requester marked it on a page. */
export const briefStepSchema = z.object({
  id: nonEmpty,
  url: nonEmpty,
  /** What the requester asked for at this step, in their words. */
  comment: text,
  viewport: z.object({ width: positive, height: positive }),
  /** Bundle paths of this step's material: screenshots and details of the marked areas. */
  files: z.array(nonEmpty),
});

export const briefExchangeSchema = z.object({
  question: z.object({ id: nonEmpty, text, options: z.array(text) }),
  /** null: nobody answered in time, and the agent goes on with its own judgement. */
  answer: z.nullable(z.object({ text })),
});

/**
 * Everything agent-host is told about its run. The steps are the task, written by the person
 * who asked; the material is page content and untrusted. agent-host decides how to put it to
 * the model.
 */
export const briefSchema = z.object({
  protocol: z.literal(AGENT_PROTOCOL_VERSION),
  runId: nonEmpty,
  taskId: nonEmpty,
  /** The commit the workspace is at; the change is made on top of it. */
  baseSha: shaSchema,
  model: nonEmpty,
  limits: z.object({
    maxTurns: positive,
    /** The whole run, from start to outcome. */
    timeoutMs: positive,
    /** No sign of life from the agent for this long ends the run. */
    stallTimeoutMs: positive,
    /** An estimate the agent stops at; the gateway enforces the real budget. */
    budgetUsd: z.nullable(z.number().check(z.positive())),
  }),
  task: z.object({ title: text, steps: z.array(briefStepSchema).check(z.minLength(1)) }),
  /** The bundle under `RUN_LAYOUT.bundle`: its entry document and every file in it. */
  material: z.object({
    entry: nonEmpty,
    files: z.array(z.object({ path: nonEmpty, mediaType: nonEmpty })),
  }),
  /** The questions asked so far and their answers, in the order asked. */
  exchanges: z.array(briefExchangeSchema),
  /** How many more questions the agent may ask the requester. */
  questionsLeft: count,
  /**
   * The paused session this run goes on with, as the run that paused left it; null starts a new
   * session, told the exchanges so far.
   */
  resume: z.nullable(pauseSchema),
  /** The project's own commands that check a change (`.redline/receiver.yaml`), run as written. */
  checks: z.array(nonEmpty),
  /** The rules the change is judged by, so the agent does not break them by accident. */
  policy: z.object({
    /** `@redline/path-patterns` globs the agent must not change. */
    protectedPaths: z.array(nonEmpty),
    maxFiles: positive,
    maxChangedLines: positive,
  }),
});

export type Brief = z.infer<typeof briefSchema>;
export type BriefStep = z.infer<typeof briefStepSchema>;
export type BriefExchange = z.infer<typeof briefExchangeSchema>;
