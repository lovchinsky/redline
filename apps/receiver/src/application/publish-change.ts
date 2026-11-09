import { describeViolation, evaluateChange, type Flag } from '../domain/change-policy';
import type { TaskId } from '../domain/ids';
import {
  cancelTask,
  markPublished,
  recordPublishFailure,
  rejectByPolicy,
  type Task,
} from '../domain/task';
import type { ChangeRequestRef } from '../domain/work';
import type { Identity, Project, ProjectCatalog } from '../ports/access';
import type { BundleReader } from '../ports/bundles';
import type {
  Forge,
  PublishError,
  Publishing,
  SecretScanner,
  SourceRepository,
} from '../ports/publishing';
import type { Logger } from '../ports/system';
import type { TaskQueries } from '../ports/tasks';
import { branchOf, composeChangeRequest, composeCommitMessage } from './change-request';
import { PROJECT_GONE } from './errors';
import type { TaskWriter } from './task-writer';

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
      readonly scanner: SecretScanner;
      readonly forge: Forge;
      readonly logger: Logger;
    },
  ) {}

  async handle(taskId: TaskId): Promise<void> {
    const task = await this.deps.queries.get(taskId);
    if (task?.state.kind !== 'publishing') return;
    const project = this.deps.projects.get(task.projectId);
    if (project === null) {
      await this.deps.writer.update(taskId, (current, now) =>
        cancelTask(current, PROJECT_GONE, now),
      );
      return;
    }

    const published = await this.publish(task, project);
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
    const recorded = await this.deps.writer.update(taskId, (current, now) =>
      markPublished(current, result.changeRequest, now),
    );
    if (recorded.ok) return;
    // Cancelled while publishing: the change request just opened must not stay open. (Another
    // conflict is a concurrent delivery of this job that published the same change request.)
    const current = await this.deps.queries.get(taskId);
    if (current?.state.kind === 'cancelled') {
      this.deps.logger.info('Withdrawing the change request of a cancelled task', { taskId });
      await this.deps.forge.close(project.repository, result.changeRequest);
    }
  }

  private async publish(
    task: Task,
    project: Project,
  ): Promise<
    Publishing<
      | { readonly kind: 'reject'; readonly summary: string }
      | { readonly kind: 'opened'; readonly changeRequest: ChangeRequestRef }
    >
  > {
    if (task.state.kind !== 'publishing' || task.baseSha === null) {
      return fail({ transient: false, detail: 'the task has no change to publish' });
    }
    const { change, report } = task.state;
    const { repository, publishing } = project;

    const judged = await this.judge(task, project, task.baseSha);
    if (!judged.ok) return judged;
    if (judged.value.kind === 'reject') return { ok: true, value: judged.value };

    const requester = await this.deps.identity.get(task.requester);
    const committed = await this.deps.source.commit(repository, {
      taskId: task.id,
      baseSha: task.baseSha,
      change,
      message: composeCommitMessage(task, requester),
      at: task.createdAt,
    });
    if (!committed.ok) return committed;

    const branch = branchOf(task);
    const pushed = await this.deps.source.push(repository, publishing, committed.value.sha, branch);
    if (!pushed.ok) return pushed;

    const existing = await this.deps.forge.findOpen(repository, publishing, branch);
    if (!existing.ok) return existing;
    if (existing.value !== null)
      return { ok: true, value: { kind: 'opened', changeRequest: existing.value } };

    const bundle = await this.deps.bundles.read(task.bundle.manifest);
    if (bundle === null)
      return fail({ transient: false, detail: 'the bundle is no longer stored' });
    const flags = judged.value.flags;
    const opened = await this.deps.forge.open(
      repository,
      publishing,
      composeChangeRequest({ task, report, flags, bundle, requester, publishing }),
    );
    return opened.ok
      ? { ok: true, value: { kind: 'opened', changeRequest: opened.value } }
      : opened;
  }

  private async judge(task: Task, project: Project, baseSha: string): Promise<Publishing<Verdict>> {
    if (task.state.kind !== 'publishing')
      return fail({ transient: false, detail: 'nothing to judge' });
    const { change } = task.state;
    const [described, secrets] = await Promise.all([
      this.deps.source.describe(project.repository, baseSha, change),
      this.deps.scanner.scan(project.repository, baseSha, change),
    ]);
    if (!described.ok) return described;
    if (!secrets.ok) return secrets;
    const verdict = evaluateChange(
      { ...described.value, secrets: secrets.value },
      project.changePolicy,
    );
    return {
      ok: true,
      value: verdict.accepted
        ? { kind: 'publish', flags: verdict.flags }
        : { kind: 'reject', summary: verdict.violations.map(describeViolation).join('; ') },
    };
  }
}

const fail = (error: PublishError): { readonly ok: false; readonly error: PublishError } => ({
  ok: false,
  error,
});
