import { askTool } from '../composition/ask-tool';

// The server of `ask_requester`, started by Claude Code; it serves until its input closes.
askTool(process.env).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
