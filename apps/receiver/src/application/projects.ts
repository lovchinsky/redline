import type { Instant } from '../domain/ids';
import { cancelTask, type Task, type TransitionResult } from '../domain/task';
import type { Project, ProjectCatalog } from '../ports/access';
import type { RepositoryDirectory, RepositoryRegistry } from '../ports/source';
import type { Logger } from '../ports/system';

/** Why a task of a project that was removed from the configuration is cancelled. */
export const PROJECT_GONE = 'The project is no longer configured on this receiver';

/** The decision about a task whose project is no longer configured: it is cancelled. */
export const projectGone = (task: Task, now: Instant): TransitionResult =>
  cancelTask(task, PROJECT_GONE, now);

/** A decision that needs the task's project, taken as `projectGone` when the project is gone. */
export const withProject =
  (
    projects: ProjectCatalog,
    decide: (task: Task, project: Project, now: Instant) => TransitionResult,
  ) =>
  (task: Task, now: Instant): TransitionResult => {
    const project = projects.get(task.projectId);
    return project === null ? projectGone(task, now) : decide(task, project, now);
  };

/**
 * Finds the repositories the git host gives the receiver and keeps them for every role to read:
 * each is a project. A host that cannot be asked leaves the repositories found before.
 */
export class DiscoverRepositories {
  constructor(
    private readonly deps: {
      readonly directory: RepositoryDirectory;
      readonly registry: RepositoryRegistry;
      readonly logger: Logger;
    },
  ) {}

  async handle(): Promise<void> {
    const found = await this.deps.directory.list();
    if (!found.ok) {
      this.deps.logger.warn('The git host did not list its repositories', {
        detail: found.error.detail,
        transient: found.error.transient,
      });
      return;
    }
    await this.deps.registry.replace(found.value);
  }
}
