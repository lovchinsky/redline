import type { CredentialKind } from '../../domain/grant';
import type { TaskId } from '../../domain/ids';
import type { CredentialVault, ModelCredential } from '../../ports/access';

/**
 * The vault of a receiver that runs every task with the operator's credential: it holds no
 * requester's credential, and is never given one.
 */
export class EmptyVault implements CredentialVault {
  deposit(taskId: TaskId, credential: ModelCredential): Promise<void> {
    return Promise.reject(
      new Error(
        `This receiver keeps no requester credentials (task ${taskId}, ${credential.kind})`,
      ),
    );
  }

  held(): Promise<CredentialKind | null> {
    return Promise.resolve(null);
  }

  forget(): Promise<void> {
    return Promise.resolve();
  }
}
