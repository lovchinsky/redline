import * as z from 'zod/mini';

/** The most a question to the requester holds: what the extension shows in one card. */
export const QUESTION_LIMITS = {
  /** Characters of the question. */
  text: 2000,
  /** Suggested answers. */
  options: 6,
  /** Characters of each suggested answer. */
  option: 200,
} as const;

/** A question as the agent asks it; the receiver gives it its id. */
export const askedQuestionSchema = z.object({
  text: z.string().check(z.minLength(1), z.maxLength(QUESTION_LIMITS.text)),
  options: z
    .array(z.string().check(z.minLength(1), z.maxLength(QUESTION_LIMITS.option)))
    .check(z.maxLength(QUESTION_LIMITS.options)),
});

export type AskedQuestion = z.infer<typeof askedQuestionSchema>;
