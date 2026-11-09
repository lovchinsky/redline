import type { Instant } from '../domain/ids';
import { cancelTask, type Task, type TransitionResult } from '../domain/task';
import type { Project, ProjectCatalog } from '../ports/access';

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
