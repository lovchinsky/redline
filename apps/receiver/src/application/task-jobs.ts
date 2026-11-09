import { expireQuestion } from '../domain/task';
import type { CredentialVault, ProjectCatalog } from '../ports/access';
import type { AgentRunner } from '../ports/agent';
import type { Job, JobHandler } from '../ports/tasks';
import { withProject } from './projects';
import type { PublishChange } from './publish-change';
import type { SuperviseRun } from './supervise-run';
import type { TaskWriter } from './task-writer';

/**
 * What the receiver does about each effect of a task, once its job is due: the one place that
 * answers for every kind. A job delivered again does no harm: each step reads the task as it is.
 */
export class TaskJobs implements JobHandler {
  constructor(
    private readonly deps: {
      readonly supervise: SuperviseRun;
      readonly publish: PublishChange;
      readonly writer: TaskWriter;
      readonly projects: ProjectCatalog;
      readonly runner: AgentRunner;
      readonly vault: CredentialVault;
    },
  ) {}

  async handle({ taskId, effect }: Job, signal: AbortSignal): Promise<void> {
    switch (effect.kind) {
      case 'schedule-run':
        return this.deps.supervise.handle(taskId, signal);
      case 'schedule-publish':
        return this.deps.publish.handle(taskId);
      case 'withdraw-change':
        return this.deps.publish.withdraw(taskId);
      case 'schedule-reply-timeout': {
        // The task goes on or fails, as its project chooses.
        await this.deps.writer.update(
          taskId,
          withProject(this.deps.projects, (task, project, now) =>
            expireQuestion(task, effect.questionId, project.policy, now),
          ),
        );
        return;
      }
      case 'end-run':
        // Its record and grants were closed with the task; what it holds where it ran goes now.
        return this.deps.runner.release(effect.runId);
      case 'forget-credential':
        return this.deps.vault.forget(taskId);
    }
  }
}
