import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { QUESTION_LIMITS } from '@redline/agent-protocol';
import * as z from 'zod/mini';
import * as zod from 'zod/v4';
import { ASK_TOOL, askReply } from '../../domain/asking';

/**
 * The variable the server of `ask_requester` reads its run's asking from: the answer the
 * session waits on and the questions left, as JSON.
 */
export const ASKING_VARIABLE = 'REDLINE_ASKING';

const askingSchema = z.object({
  pending: z.nullable(z.object({ call: z.string(), text: z.string() })),
  questionsLeft: z.int().check(z.nonnegative()),
});

export type Asking = z.infer<typeof askingSchema>;

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
 * The MCP server of `ask_requester`, which Claude Code starts and talks to over stdio. It runs
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
      inputSchema: {
        question: zod.string().max(QUESTION_LIMITS.text).describe('The question, in plain words'),
        options: zod
          .array(zod.string().max(QUESTION_LIMITS.option))
          .max(QUESTION_LIMITS.options)
          .optional()
          .describe('Suggested answers the requester may pick from'),
      },
    },
    (_input, extra) => {
      const reply = askReply(callIdOf(extra._meta), asking);
      return {
        content: [{ type: 'text' as const, text: reply.text }],
        ...(reply.isError ? { isError: true } : {}),
      };
    },
  );
  await server.connect(new StdioServerTransport());
};
