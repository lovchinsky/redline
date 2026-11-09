import type { Server } from 'node:http';
import { parseArgs } from 'node:util';
import { TaskId, UserId } from '../domain/ids';
import {
  administration,
  assemble,
  loadConfig,
  loggerFor,
  migrateStorage,
  type Role,
} from './receiver';
import { checkDeployment } from './check';
import { settingsFrom } from './settings';

const USAGE = `Usage: receiver <command>

  serve api|worker|gateway|egress|all
                                  Serve the API, work the queues, serve the gateway's model or
                                  egress side, or all of them in one process
  migrate                         Bring the database schema and the queues up to date: before
                                  the first start and after each upgrade (a worker does too)
  config check [--offline]        Validate the configuration, then check what it names:
                                  repositories, publishing targets, the secret scanner,
                                  sandboxes and their image, the operator's credential
  users add <id> --name <name> [--email <email>]
  users token <id> [--label <label>]   Issue an access token (shown once)
  users revoke <id>               Revoke every token of a user
  users list
  tasks show <id>                 A task and its history
  tasks cancel <id> --reason <text>

Environment: DATABASE_URL, REDLINE_CONFIG, REDLINE_BLOBS, REDLINE_HOST, REDLINE_PORT,
REDLINE_GATEWAY_PORT, REDLINE_EGRESS_PORT, REDLINE_VAULT_SOCKET, REDLINE_LOG_LEVEL.`;

const print = (text: string) => {
  process.stdout.write(`${text}\n`);
};

class UsageError extends Error {}

const argument = (positionals: readonly string[], index: number, name: string): string => {
  const value = positionals[index];
  if (value === undefined || value === '') throw new UsageError(`Missing ${name}`);
  return value;
};

const ROLES: readonly Role[] = ['api', 'worker', 'gateway', 'egress', 'all'];

const listen = (server: Server, host: string, port: number) =>
  new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve(
        typeof address === 'object' && address !== null
          ? `${address.address}:${String(address.port)}`
          : String(address),
      );
    });
  });

/** Runs one command of the operator's command line; resolves with the process's exit code. */
export const run = async (argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> => {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      email: { type: 'string' },
      label: { type: 'string' },
      reason: { type: 'string' },
      help: { type: 'boolean' },
      offline: { type: 'boolean' },
    },
  });
  const [command, sub] = positionals;
  if (values.help === true || command === undefined) {
    print(USAGE);
    return values.help === true ? 0 : 2;
  }
  const settings = settingsFrom(env);

  try {
    if (command === 'serve') {
      const role = ROLES.find((candidate) => candidate === sub);
      if (role === undefined) throw new UsageError(`serve takes ${ROLES.join(', ')}`);
      const logger = loggerFor(settings, role);
      const receiver = await assemble(
        settings,
        await loadConfig(settings.configPath),
        role,
        logger,
      );
      if (receiver.api !== null) {
        const address = await receiver.api.listen({ host: settings.host, port: settings.port });
        logger.info('Serving receiver-api.v1', { address });
      }
      if (receiver.gateway !== null) {
        const address = await listen(receiver.gateway, settings.host, settings.gatewayPort);
        logger.info('Serving the model gateway', { address });
      }
      if (receiver.egress !== null) {
        const address = await listen(receiver.egress, settings.host, settings.egressPort);
        logger.info('Serving the egress proxy', { address });
      }
      logger.info('Receiver started', { role });
      await new Promise<void>((resolve) => {
        const stop = () => {
          logger.info('Stopping');
          resolve();
        };
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
      });
      await receiver.stop();
      return 0;
    }

    if (command === 'config' && sub === 'check') {
      const config = await loadConfig(settings.configPath);
      print(`${settings.configPath} is valid.`);
      print(
        `Model credentials: ${config.modelAccess.credentials}; agent: ${config.agent.kind}; git: ${config.git.kind}`,
      );
      for (const project of config.projects) {
        print(
          `  ${project.id} (${project.name}): ${project.repository.host}:${project.repository.name}@${project.repository.baseBranch}`,
        );
      }
      if (values.offline === true) return 0;
      const checks = await checkDeployment(settings, config, loggerFor(settings, 'cli'));
      for (const check of checks)
        print(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`);
      return checks.every((check) => check.ok) ? 0 : 1;
    }

    if (command === 'migrate') {
      await migrateStorage(
        settings,
        await loadConfig(settings.configPath),
        loggerFor(settings, 'cli'),
      );
      print('The database schema and the queues are up to date.');
      return 0;
    }

    const admin = await administration(
      settings,
      await loadConfig(settings.configPath),
      loggerFor(settings, 'cli'),
    );
    try {
      if (command === 'users' && sub === 'add') {
        const id = argument(positionals, 2, 'user id');
        if (values.name === undefined) throw new UsageError('users add needs --name');
        const added = await admin.users.add(
          { id: UserId(id), name: values.name, email: values.email ?? null },
          new Date(),
        );
        print(added === 'added' ? `Added ${id}.` : `${id} already exists.`);
        return 0;
      }
      if (command === 'users' && sub === 'token') {
        const id = argument(positionals, 2, 'user id');
        const token = await admin.users.issueToken(
          UserId(id),
          values.label ?? 'extension',
          new Date(),
        );
        if (token === null) {
          process.stderr.write(`No user ${id}.\n`);
          return 1;
        }
        print(token);
        process.stderr.write('Shown once: set it as the receiver token in the extension.\n');
        return 0;
      }
      if (command === 'users' && sub === 'revoke') {
        const id = argument(positionals, 2, 'user id');
        print(
          `Revoked ${String(await admin.users.revokeTokens(UserId(id), new Date()))} token(s) of ${id}.`,
        );
        return 0;
      }
      if (command === 'users' && sub === 'list') {
        for (const user of await admin.users.list()) {
          print(
            `${user.id}\t${user.name}\t${user.email ?? '-'}\t${String(user.tokens)} active token(s)`,
          );
        }
        return 0;
      }
      if (command === 'tasks' && sub === 'show') {
        const shown = await admin.tasks.show(TaskId(argument(positionals, 2, 'task id')));
        if (shown === null) {
          process.stderr.write('No such task.\n');
          return 1;
        }
        print(JSON.stringify(shown, null, 2));
        return 0;
      }
      if (command === 'tasks' && sub === 'cancel') {
        if (values.reason === undefined) throw new UsageError('tasks cancel needs --reason');
        const cancelled = await admin.tasks.cancel(
          TaskId(argument(positionals, 2, 'task id')),
          values.reason,
        );
        if (!cancelled.ok) {
          process.stderr.write(`${cancelled.error.message}\n`);
          return 1;
        }
        print(`Cancelled ${cancelled.value.id}.`);
        return 0;
      }
      throw new UsageError(`Unknown command: ${positionals.join(' ')}`);
    } finally {
      await admin.close();
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }
};
