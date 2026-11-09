import { agentHost } from '../composition/agent-host';

// Exit 0 once the outcome is written, whatever it says; anything else means there is none.
Promise.resolve()
  .then(() => agentHost(process.env).execute())
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
