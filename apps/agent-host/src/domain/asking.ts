import {
  QUESTION_LIMITS,
  askedQuestionSchema,
  type AskedQuestion,
  type BriefExchange,
} from '@redline/agent-protocol';

/** The tool the agent asks the requester with. */
export const ASK_TOOL = {
  server: 'redline',
  name: 'ask_requester',
  /** The name Claude Code gives the tool of the server `redline`. */
  qualified: 'mcp__redline__ask_requester',
  description: [
    'Ask the person who requested the change one question, and wait for the answer.',
    'Ask only when the answer changes what you would do; otherwise decide yourself and record',
    'the assumption in your report. Call this tool alone, in a turn of its own: the run pauses',
    'until the person answers, and you go on with the answer as the tool’s result.',
    `At most ${String(QUESTION_LIMITS.text)} characters, with up to`,
    `${String(QUESTION_LIMITS.options)} short suggested answers the person may pick from.`,
  ].join(' '),
} as const;

/** How the session goes on with the answer to the question it stopped at. */
export interface PendingAnswer {
  /** The deferred tool call the answer is the result of. */
  readonly call: string;
  readonly text: string;
}

/** What becomes of one call of `ask_requester`. */
export type AskTurn =
  /** The run ends with the question and waits for the answer. */
  | { readonly kind: 'pause' }
  /** The call returns at once with `text`. */
  | { readonly kind: 'reply'; readonly text: string; readonly isError: boolean }
  /** The question cannot be shown to the requester: the agent is told why, and asks again. */
  | { readonly kind: 'refuse'; readonly reason: string };

const NO_QUESTIONS_LEFT =
  'You cannot ask more questions in this task. Decide yourself and record the assumption in your report.';

const ASK_ALONE =
  'The question was not asked: call ask_requester alone, in a turn of its own, with no other tool calls.';

const UNSHOWABLE = [
  'The question was not asked: it needs a question in plain words of at most',
  `${String(QUESTION_LIMITS.text)} characters, and at most ${String(QUESTION_LIMITS.options)}`,
  `suggested answers of at most ${String(QUESTION_LIMITS.option)} characters each.`,
].join(' ');

/**
 * Decides a call of `ask_requester` with `input`. The call the session waited on gets its
 * answer; with no questions left, the agent is told to decide itself; a question the requester
 * could not be shown is refused before it pauses anything; any other call pauses the run. A
 * null `call` is one whose id is unknown, which is never the call the session waited on.
 */
export const askTurn = (
  call: string | null,
  input: unknown,
  context: { readonly pending: PendingAnswer | null; readonly questionsLeft: number },
): AskTurn => {
  if (call !== null && context.pending?.call === call)
    return { kind: 'reply', text: context.pending.text, isError: false };
  if (context.questionsLeft === 0)
    return { kind: 'reply', text: NO_QUESTIONS_LEFT, isError: false };
  if (questionOf(input) === null) return { kind: 'refuse', reason: UNSHOWABLE };
  return { kind: 'pause' };
};

/**
 * What a call of `ask_requester` returns when it runs. A call meant to pause the run runs only
 * when Claude Code could not pause on it, e.g. beside other calls in one turn: the agent is told
 * to ask again, alone.
 */
export const askReply = (
  call: string | null,
  input: unknown,
  context: { readonly pending: PendingAnswer | null; readonly questionsLeft: number },
): Extract<AskTurn, { kind: 'reply' }> => {
  const turn = askTurn(call, input, context);
  switch (turn.kind) {
    case 'reply':
      return turn;
    case 'refuse':
      return { kind: 'reply', text: turn.reason, isError: true };
    case 'pause':
      return { kind: 'reply', text: ASK_ALONE, isError: true };
  }
};

/** The answer a resumed session gets for the question it stopped at: the last exchange's. */
export const answerText = (exchange: BriefExchange): string =>
  exchange.answer === null
    ? 'Nobody answered in time. Decide yourself and record the assumption in your report.'
    : exchange.answer.text;

/** The message a resumed session goes on with when it stopped without a question. */
export const GO_ON =
  'The run stopped before you finished, and now goes on. Continue the task from where you stopped.';

/** The question of a deferred call, or null when its input is not a question the requester can see. */
export const questionOf = (input: unknown): AskedQuestion | null => {
  if (typeof input !== 'object' || input === null) return null;
  const fields = input as Record<string, unknown>;
  const parsed = askedQuestionSchema.safeParse({
    text: typeof fields['question'] === 'string' ? fields['question'].trim() : fields['question'],
    options: fields['options'] ?? [],
  });
  return parsed.success ? parsed.data : null;
};
