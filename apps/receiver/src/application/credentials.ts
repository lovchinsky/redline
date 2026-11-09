import { isTerminal, type Task } from '../domain/task';
import { err, ok, type Result } from '../domain/result';
import type { CredentialVault, ModelAccessPolicy, ModelCredential } from '../ports/access';
import type { Logger } from '../ports/system';
import type { RequestError } from './errors';
import type { TaskWriter } from './task-writer';

/** Whether a requester may bring a credential of this kind. */
const accepted = (policy: ModelAccessPolicy, credential: ModelCredential): boolean =>
  credential.kind === 'api-key' || policy.acceptRequesterSubscriptions;

/**
 * Whose credential a new task runs with. A credential sent to a receiver that runs everything
 * with the operator's is not kept: it is not needed.
 */
export const credentialsFor = (
  policy: ModelAccessPolicy,
  credential: ModelCredential | null,
): Result<Task['credentials'], RequestError> => {
  if (policy.credentials === 'managed') return ok('operator');
  if (credential !== null && !accepted(policy, credential)) {
    return err({
      code: 'credential',
      reason: 'refused-kind',
      message: 'This receiver does not accept subscription tokens; use an API key',
    });
  }
  if (credential !== null) return ok('requester');
  return policy.credentials === 'optional'
    ? ok('operator')
    : err({
        code: 'credential',
        reason: 'required',
        message: 'This receiver runs tasks with your own model credential; set it in the extension',
      });
};

/**
 * Hands the requester's credential to the vault on every request about a task that runs with
 * it. A queued task that was waiting for its credential (the vault forgot it, e.g. on restart)
 * gets its run scheduled at once.
 */
export class CredentialRelay {
  constructor(
    private readonly deps: {
      readonly vault: CredentialVault;
      readonly writer: TaskWriter;
      readonly policy: ModelAccessPolicy;
      readonly logger: Logger;
    },
  ) {}

  async refresh(task: Task, credential: ModelCredential | null): Promise<void> {
    if (credential === null || task.credentials !== 'requester' || isTerminal(task)) return;
    if (!accepted(this.deps.policy, credential)) {
      this.deps.logger.warn('Ignoring a credential of a kind this receiver does not accept', {
        taskId: task.id,
        kind: credential.kind,
      });
      return;
    }
    const held = await this.deps.vault.holds(task.id);
    await this.deps.vault.deposit(task.id, credential);
    if (!held && task.state.kind === 'queued') {
      await this.deps.writer.schedule({ queue: 'run', taskId: task.id, projectId: task.projectId });
    }
  }
}
