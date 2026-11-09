import { askingOf, serveAskTool } from '../adapters/claude/ask-tool';

type Env = Readonly<Record<string, string | undefined>>;

/** The server of `ask_requester` as Claude Code starts it for agent-host's session. */
export const askTool = (env: Env): Promise<void> => serveAskTool(askingOf(env));
