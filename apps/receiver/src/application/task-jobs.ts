import type { QuestionId, RunId, TaskId } from '../domain/ids';
import { cancelTask, expireQuestion } from '../domain/task';
import type { CredentialVault, ProjectCatalog } from '../ports/access';
import type { AgentRunner } from '../ports/agent';
import type { Forge } from '../ports/publishing';
import type { Logger } from '../ports/system';
import type { TaskQueries, UnitOfWork } from '../ports/tasks';
import { branchOf } from './change-request';
import { PROJECT_GONE } from './errors';
import type { TaskWriter } from './task-writer';

/** A question's time ran out: the task goes on or fails, as its project chooses. */
export class ExpireQuestion {
  constructor(
    private readonly deps: { readonly writer: TaskWriter; readonly projects: ProjectCatalog },
  ) {}

  async handle(taskId: TaskId, questionId: QuestionId): Promise<void> {
    await this.deps.writer.update(taskId, (task, now) => {
      const project = this.deps.projects.get(task.projectId);
      return project === null
        ? cancelTask(task, PROJECT_GONE, now)
        : expireQuestion(task, questionId, project.policy, now);
    });
  }
}

/**
 * Frees what a run the task no longer wants holds: its sandbox stops and its volumes go. Its
 * record and grants were closed when the task moved on.
 */
export class AbortRun {
  constructor(private readonly deps: { readonly runner: AgentRunner }) {}

  async handle(runId: RunId): Promise<void> {
    await this.deps.runner.release(runId);
  }
}

/** Lets go of the requester's credential once the task is over. */
export class ForgetCredential {
  constructor(private readonly deps: { readonly vault: CredentialVault }) {}

  async handle(taskId: TaskId): Promise<void> {
    await this.deps.vault.forget(taskId);
  }
}

/**
 * Frees what runs that are over still hold where they ran: a sandbox whose outcome was applied
 * but not released (the worker stopped in between), or one whose run never got a record.
 */
export class ReleaseStrays {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly runner: AgentRunner;
      readonly logger: Logger;
    },
  ) {}

  async handle(): Promise<void> {
    for (const runId of await this.deps.runner.live()) {
      const run = await this.deps.uow.run((scope) => scope.runs.get(runId));
      if (run?.state.kind === 'started') continue;
      this.deps.logger.info('Releasing a stray run', { runId, state: run?.state.kind ?? 'none' });
      await this.deps.runner.release(runId);
    }
  }
}

/** Closes the change request a task cancelled while publishing may have opened. */
export class WithdrawChange {
  constructor(
    private readonly deps: {
      readonly queries: TaskQueries;
      readonly projects: ProjectCatalog;
      readonly forge: Forge;
      readonly logger: Logger;
    },
  ) {}

  async handle(taskId: TaskId): Promise<void> {
    const task = await this.deps.queries.get(taskId);
    if (task?.state.kind !== 'cancelled') return;
    const project = this.deps.projects.get(task.projectId);
    if (project === null) return;
    const open = await this.deps.forge.findOpen(
      project.repository,
      project.publishing,
      branchOf(task),
    );
    if (!open.ok) throw new Error(`Cannot look up the change request: ${open.error.detail}`);
    if (open.value === null) return;
    const closed = await this.deps.forge.close(project.repository, open.value);
    if (!closed.ok) throw new Error(`Cannot close the change request: ${closed.error.detail}`);
    this.deps.logger.info('Withdrew the change request of a cancelled task', {
      taskId,
      url: open.value.url,
    });
  }
}
