import { fileURLToPath } from 'node:url';
import { agentHost } from '../composition/agent-host';

/** The server of `ask_requester`: the bundle built beside this one (`scripts/build.mjs`). */
const askTool = {
  command: process.execPath,
  args: [fileURLToPath(new URL('./ask-tool.mjs', import.meta.url))],
};

// Exit 0 once the outcome is written, whatever it says; anything else means there is none.
Promise.resolve()
  .then(() => agentHost(process.env, askTool).execute())
  .then(
    () => {
      process.exitCode = 0;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
