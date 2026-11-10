import { describeViolation, evaluateChange, type Flag } from '../domain/change-policy';
import type { TaskId } from '../domain/ids';
import { err, ok } from '../domain/result';
import {
  markPublished,
  recordPublishFailure,
  rejectByPolicy,
  type Task,
  type TaskState,
} from '../domain/task';
import type { ChangeRequestRef } from '../domain/work';
import type { Identity, Project, ProjectCatalog } from '../ports/access';
import type { BundleReader } from '../ports/bundles';
import type { Forge, Publishing } from '../ports/publishing';
import type { GitIdentity, SourceRepository } from '../ports/source';
import type { Logger } from '../ports/system';
import type { TaskQueries } from '../ports/tasks';
import { branchOf, composeChangeRequest, composeCommit } from './change-request';
import { projectGone } from './projects';
import type { TaskWriter } from './task-writer';

/** What a task being published holds: the change, on top of its base, and the agent's report. */
type Publication = Extract<TaskState, { readonly kind: 'publishing' }>;

type Verdict =
  | { readonly kind: 'publish'; readonly flags: readonly Flag[] }
  | { readonly kind: 'reject'; readonly summary: string };

/**
 * Turns a task's proposed change into a change request: the change is judged by the project's
 * policy, committed as one deterministic commit, pushed to the task's own branch, and offered
 * as a change request found or opened for that branch. Every step can be repeated after a crash
 * and lands on the same commit, branch and change request.
 */
export class PublishChange {
  constructor(
    private readonly deps: {
      readonly queries: TaskQueries;
      readonly writer: TaskWriter;
      readonly projects: ProjectCatalog;
      readonly bundles: BundleReader;
      readonly identity: Identity;
      readonly source: SourceRepository;
      readonly forge: Forge;
      /** The receiver as its commits name it: the co-author of every task's commit. */
      readonly receiver: GitIdentity;
      readonly logger: Logger;
    },
  ) {}

  async handle(taskId: TaskId): Promise<void> {
    const task = await this.deps.queries.get(taskId);
    if (task?.state.kind !== 'publishing') return;
    const project = this.deps.projects.get(task.projectId);
    if (project === null) {
      await this.deps.writer.update(taskId, projectGone);
      return;
    }

    const published = await this.publish(task, task.state, project);
    if (!published.ok) {
      await this.deps.writer.update(taskId, (current, now) =>
        recordPublishFailure(current, published.error, project.policy, now),
      );
      return;
    }
    const result = published.value;
    if (result.kind === 'reject') {
      await this.deps.writer.update(taskId, (current, now) =>
        rejectByPolicy(current, result.summary, now),
      );
      return;
    }
    // A task cancelled meanwhile has the change request withdrawn (`markPublished`); a conflict
    // is a concurrent delivery of this job that published the same change request.
    await this.deps.writer.update(taskId, (current, now) =>
      markPublished(current, result.changeRequest, now),
    );
  }

  /** Closes the change request a task cancelled while publishing may have opened. */
  async withdraw(taskId: TaskId): Promise<void> {
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

  private async publish(
    task: Task,
    publication: Publication,
    project: Project,
  ): Promise<
    Publishing<
      | { readonly kind: 'reject'; readonly summary: string }
      | { readonly kind: 'opened'; readonly changeRequest: ChangeRequestRef }
    >
  > {
    const { baseSha, change, report } = publication;
    const { repository, publishing } = project;

    const judged = await this.judge(publication, project);
    if (!judged.ok) return judged;
    if (judged.value.kind === 'reject') return ok(judged.value);

    const requester = await this.deps.identity.get(task.requester);
    const committed = await this.deps.source.commit(repository, {
      baseSha,
      change,
      ...composeCommit(task, requester, this.deps.receiver),
      at: task.createdAt,
    });
    if (!committed.ok) return committed;

    const branch = branchOf(task);
    const pushed = await this.deps.source.push(repository, publishing, committed.value.sha, branch);
    if (!pushed.ok) return pushed;

    const existing = await this.deps.forge.findOpen(repository, publishing, branch);
    if (!existing.ok) return existing;
    if (existing.value !== null) return ok({ kind: 'opened', changeRequest: existing.value });

    const bundle = await this.deps.bundles.read(task.bundle.manifest);
    if (bundle === null) return err({ transient: false, detail: 'the bundle is no longer stored' });
    const flags = judged.value.flags;
    const opened = await this.deps.forge.open(
      repository,
      publishing,
      composeChangeRequest({ task, report, flags, bundle, requester, publishing }),
    );
    return opened.ok ? ok({ kind: 'opened', changeRequest: opened.value }) : opened;
  }

  private async judge(
    { baseSha, change }: Publication,
    project: Project,
  ): Promise<Publishing<Verdict>> {
    const described = await this.deps.source.describe(project.repository, baseSha, change);
    if (!described.ok) return described;
    const verdict = evaluateChange(described.value, project.changePolicy);
    return ok(
      verdict.accepted
        ? { kind: 'publish', flags: verdict.flags }
        : { kind: 'reject', summary: verdict.violations.map(describeViolation).join('; ') },
    );
  }
}
