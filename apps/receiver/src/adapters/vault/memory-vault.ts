import type { TaskId } from '../../domain/ids';
import type { CredentialKind } from '../../domain/grant';
import type { CredentialVault, HeldCredentials, ModelCredential } from '../../ports/access';
import type { Clock } from '../../ports/system';

/**
 * Requesters' credentials in this process's memory, and nowhere else. A credential nobody
 * refreshed for `idleMs` is dropped: the extension brings it back with its next request.
 * Holds them for a receiver that calls the model in-process; with a separate gateway, the
 * gateway holds them.
 */
export class MemoryVault implements CredentialVault, HeldCredentials {
  private readonly entries = new Map<TaskId, { credential: ModelCredential; touchedAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly idleMs: number,
  ) {}

  deposit(taskId: TaskId, credential: ModelCredential): Promise<void> {
    this.entries.set(taskId, { credential, touchedAt: this.clock.now() });
    return Promise.resolve();
  }

  held(taskId: TaskId): Promise<CredentialKind | null> {
    return Promise.resolve(this.credentialOf(taskId)?.kind ?? null);
  }

  forget(taskId: TaskId): Promise<void> {
    this.entries.delete(taskId);
    return Promise.resolve();
  }

  /** The credential of a task, for the component that calls the model. */
  credentialOf(taskId: TaskId): ModelCredential | null {
    this.sweep();
    return this.entries.get(taskId)?.credential ?? null;
  }

  private sweep(): void {
    const oldest = this.clock.now() - this.idleMs;
    for (const [taskId, entry] of this.entries)
      if (entry.touchedAt < oldest) this.entries.delete(taskId);
  }
}
