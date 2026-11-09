import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { QUESTION_LIMITS, askedQuestionSchema, type AskedQuestion } from '@redline/agent-protocol';
import * as z from 'zod/mini';
import * as zod from 'zod/v4';
import { ASK_TOOL_NAME, askReply, type Asking } from '../../domain/asking';

/** The ask tool as Claude Code has it: a tool of the MCP server `redline`. */
export const ASK_TOOL = {
  server: 'redline',
  name: ASK_TOOL_NAME,
  /** The name Claude Code gives the tool of the server `redline`. */
  qualified: `mcp__redline__${ASK_TOOL_NAME}`,
  description: [
    'Ask the person who requested the change one question, and wait for the answer.',
    'Ask only when the answer changes what you would do; otherwise decide yourself and record',
    'the assumption in your report. Call this tool alone, in a turn of its own: the run pauses',
    'until the person answers, and you go on with the answer as the tool’s result.',
    `At most ${String(QUESTION_LIMITS.text)} characters, with up to`,
    `${String(QUESTION_LIMITS.options)} short suggested answers the person may pick from.`,
  ].join(' '),
} as const;

/** The question of a call's input, or null when it is not one the requester can be shown. */
export const questionOf = (input: unknown): AskedQuestion | null => {
  if (typeof input !== 'object' || input === null) return null;
  const fields = input as Record<string, unknown>;
  const parsed = askedQuestionSchema.safeParse({
    text: typeof fields['question'] === 'string' ? fields['question'].trim() : fields['question'],
    options: fields['options'] ?? [],
  });
  return parsed.success ? parsed.data : null;
};

/**
 * The variable the server of the ask tool reads its run's asking from: the answer the session
 * waits on and the questions left, as JSON.
 */
export const ASKING_VARIABLE = 'REDLINE_ASKING';

const askingSchema = z.object({
  pending: z.nullable(z.object({ call: z.string(), text: z.string() })),
  questionsLeft: z.int().check(z.nonnegative()),
});

/** The asking agent-host gave the server, from the server's environment. */
export const askingOf = (env: Readonly<Record<string, string | undefined>>): Asking => {
  const value = env[ASKING_VARIABLE];
  if (value === undefined) throw new Error(`Set ${ASKING_VARIABLE}: agent-host starts this server`);
  return askingSchema.parse(JSON.parse(value));
};

/** The key Claude Code passes a tool call's id under, in the `_meta` of an MCP call. */
const TOOL_USE_ID = 'claudecode/toolUseId';

const callIdOf = (meta: unknown): string | null => {
  if (typeof meta !== 'object' || meta === null) return null;
  const id = (meta as Record<string, unknown>)[TOOL_USE_ID];
  return typeof id === 'string' ? id : null;
};

/**
 * The MCP server of the ask tool, which Claude Code starts and talks to over stdio. It runs
 * apart from agent-host because a resumed session runs the call it waits on as it starts, and
 * only a server Claude Code connects to before the session starts can answer it then. A call
 * pauses the run in agent-host's hook before it gets here; the calls that do get here are
 * answered at once (`askReply`).
 */
export const serveAskTool = async (asking: Asking): Promise<void> => {
  const server = new McpServer({ name: ASK_TOOL.server, version: '1.0.0' });
  server.registerTool(
    ASK_TOOL.name,
    {
      description: ASK_TOOL.description,
      // What the model sees of the tool; `questionOf` holds a call to the question's own schema.
      inputSchema: {
        question: zod.string().max(QUESTION_LIMITS.text).describe('The question, in plain words'),
        options: zod
          .array(zod.string().max(QUESTION_LIMITS.option))
          .max(QUESTION_LIMITS.options)
          .optional()
          .describe('Suggested answers the requester may pick from'),
      },
    },
    (input, extra) => {
      const reply = askReply(callIdOf(extra._meta), questionOf(input), asking);
      return {
        content: [{ type: 'text' as const, text: reply.text }],
        ...(reply.isError ? { isError: true } : {}),
      };
    },
  );
  await server.connect(new StdioServerTransport());
};
