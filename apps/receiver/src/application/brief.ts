import { questionsLeft, type Task } from '../domain/task';
import type { Project } from '../ports/access';
import type { AgentBrief } from '../ports/agent';
import type { BundleContents } from '../ports/bundles';
import type { RepositorySettings } from '../ports/source';

/**
 * What the agent is told: the task (the requester's steps), the page material (the bundle's
 * files, untrusted), the conversation so far, the rules its change is judged by, so it does not
 * break them by accident, and the checks the project's team runs on a change.
 */
export const composeBrief = (
  task: Task,
  bundle: BundleContents,
  project: Project,
  settings: RepositorySettings,
): AgentBrief => ({
  title: task.bundle.title,
  bundle,
  exchanges: task.exchanges,
  questionsLeft: questionsLeft(task, project.policy),
  protectedPaths: project.changePolicy.deny,
  limits: {
    maxFiles: project.changePolicy.maxFiles,
    maxChangedLines: project.changePolicy.maxChangedLines,
  },
  checks: settings.checks,
});
