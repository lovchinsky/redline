import { QUESTION_LIMITS, type AskedQuestion } from '@redline/agent-protocol';

/** The tool the agent asks the requester with, by the name the agent knows it. */
export const ASK_TOOL_NAME = 'ask_requester';

/** How the session goes on with the answer to the question it stopped at. */
export interface PendingAnswer {
  /** The deferred tool call the answer is the result of. */
  readonly call: string;
  readonly text: string;
}

/** Where a run's questions stand: the answer the session waits on, and how many more it may ask. */
export interface Asking {
  readonly pending: PendingAnswer | null;
  readonly questionsLeft: number;
}

/** What becomes of one call of the ask tool. */
export type AskTurn =
  /** The run ends with the question and waits for the answer. */
  | { readonly kind: 'pause' }
  /** The call returns at once with `text`. */
  | { readonly kind: 'reply'; readonly text: string; readonly isError: boolean }
  /** The question cannot be shown to the requester: the agent is told why, and asks again. */
  | { readonly kind: 'refuse'; readonly reason: string };

const NO_QUESTIONS_LEFT =
  'You cannot ask more questions in this task. Decide yourself and record the assumption in your report.';

const ASK_ALONE = `The question was not asked: call ${ASK_TOOL_NAME} alone, in a turn of its own, with no other tool calls.`;

const UNSHOWABLE = [
  'The question was not asked: it needs a question in plain words of at most',
  `${String(QUESTION_LIMITS.text)} characters, and at most ${String(QUESTION_LIMITS.options)}`,
  `suggested answers of at most ${String(QUESTION_LIMITS.option)} characters each.`,
].join(' ');

/**
 * Decides a call of the ask tool that asks `question` (null: a question the requester could not
 * be shown). The call the session waited on gets its answer; with no questions left, the agent
 * is told to decide itself; a question the requester could not be shown is refused before it
 * pauses anything; any other call pauses the run. A null `call` is one whose id is unknown,
 * which is never the call the session waited on.
 */
export const askTurn = (
  call: string | null,
  question: AskedQuestion | null,
  asking: Asking,
): AskTurn => {
  if (call !== null && asking.pending?.call === call)
    return { kind: 'reply', text: asking.pending.text, isError: false };
  if (asking.questionsLeft === 0) return { kind: 'reply', text: NO_QUESTIONS_LEFT, isError: false };
  if (question === null) return { kind: 'refuse', reason: UNSHOWABLE };
  return { kind: 'pause' };
};

/**
 * What a call of the ask tool returns when it runs. A call meant to pause the run runs only
 * when the session could not pause on it, e.g. beside other calls in one turn: the agent is
 * told to ask again, alone.
 */
export const askReply = (
  call: string | null,
  question: AskedQuestion | null,
  asking: Asking,
): Extract<AskTurn, { kind: 'reply' }> => {
  const turn = askTurn(call, question, asking);
  switch (turn.kind) {
    case 'reply':
      return turn;
    case 'refuse':
      return { kind: 'reply', text: turn.reason, isError: true };
    case 'pause':
      return { kind: 'reply', text: ASK_ALONE, isError: true };
  }
};

/** The text a resumed session gets for the question it stopped at: the answer, or why none. */
export const answerText = (answer: { readonly text: string } | null): string =>
  answer === null
    ? 'Nobody answered in time. Decide yourself and record the assumption in your report.'
    : answer.text;

/** The message a resumed session goes on with when it stopped without a question. */
export const GO_ON =
  'The run stopped before you finished, and now goes on. Continue the task from where you stopped.';
