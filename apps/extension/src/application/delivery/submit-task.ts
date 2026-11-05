import {
  DeliveryId,
  appError,
  err,
  formatBindingPattern,
  hostPermissionOf,
  ok,
  reopenDraft,
  rescheduleDelivery,
  resolveBinding,
  retryDelivery,
  sendDraft,
  sitePatternOf,
  type AppError,
  type Binding,
  type Clock,
  type IdGenerator,
  type Logger,
  type Result,
  type TaskContent,
  type TaskId,
} from '@redline/core';
import type { AppEvents, DeliveryTarget, EventPublisher, ProjectRef } from '@redline/rpc';
import type { BindingStore } from '../../ports/delivery';
import type { ActiveDraftStore, DraftRepository, TaskRepository } from '../../ports/workspace';
import type { BundleAssembler } from '../drafts/assemble-bundle';
import type { WorkspaceWriter } from '../workspace/workspace-writer';
import type { DeliverQueued } from './deliver-queued';

type Done = Result<Record<string, never>, AppError>;

interface StepSite {
  readonly origin: string;
  readonly binding: Binding | null;
  /** The host access that lets capture start with pages of this site. */
  readonly permission: string;
}

/**
 * The site of every step that can be bound, and the binding that applies to the step's page.
 * Steps on local files have no site: they take whichever project the others agree on.
 */
const sitesOf = (task: TaskContent, bindings: readonly Binding[]): StepSite[] =>
  task.steps.flatMap((step) => {
    const url = new URL(step.page.url);
    const site = sitePatternOf(url);
    return site === null
      ? []
      : [
          {
            origin: formatBindingPattern(site),
            binding: resolveBinding(bindings, url),
            permission: hostPermissionOf(site),
          },
        ];
  });

const targetOf = (sites: readonly StepSite[]): DeliveryTarget => {
  const projects = new Map<string, ProjectRef>();
  for (const { binding } of sites) {
    if (binding !== null)
      projects.set(binding.projectId, { id: binding.projectId, name: binding.projectName });
  }
  const unique = new Map<string, StepSite>();
  for (const site of sites) if (!unique.has(site.origin)) unique.set(site.origin, site);
  const [only] = projects.values();
  const unbound = [...unique.values()].filter((site) => site.binding === null);
  return {
    sites: [...unique.values()].map(({ origin, binding }) => ({ origin, binding })),
    project: projects.size === 1 ? (only ?? null) : null,
    conflict: projects.size > 1,
    hostPermissions: [...new Set(unbound.map((site) => site.permission))],
  };
};

export interface SubmitTaskDeps {
  readonly drafts: DraftRepository;
  readonly active: ActiveDraftStore;
  readonly bindings: BindingStore;
  readonly assembler: BundleAssembler;
  readonly outbox: DeliverQueued;
  readonly writer: WorkspaceWriter;
  readonly events: EventPublisher<AppEvents>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Which project a draft would go to, from the bindings of the pages its steps were taken on. */
export class ResolveDeliveryTarget {
  constructor(private readonly deps: Pick<SubmitTaskDeps, 'drafts' | 'bindings'>) {}

  async execute(taskId: TaskId): Promise<Result<DeliveryTarget, AppError>> {
    const [draft, bindings] = await Promise.all([
      this.deps.drafts.get(taskId),
      this.deps.bindings.all(),
    ]);
    if (!draft.ok) return draft;
    if (!bindings.ok) return bindings;
    return ok(targetOf(sitesOf(draft.value, bindings.value)));
  }
}

/** What the user sends: the draft as they saw it, and the project if they picked one. */
export interface SubmitRequest {
  readonly taskId: TaskId;
  /** Revision of the draft the user looked at; anything newer was not approved. */
  readonly revision: number;
  readonly project: ProjectRef | null;
}

/**
 * Sends a draft: freezes its bundle (the one the preview showed), turns it into a task waiting
 * in the outbox, and binds its unbound sites to the chosen project. Only the revision the user
 * saw is sent: a step added meanwhile (from another tab) stops it. The draft is gone, so the
 * next circled step starts a new one. Delivery itself happens in the outbox, now or later.
 */
export class SubmitTask {
  constructor(private readonly deps: SubmitTaskDeps) {}

  async execute({ taskId, revision, project }: SubmitRequest): Promise<Done> {
    const { drafts, active, bindings, assembler, writer, ids, clock } = this.deps;
    const queued = await writer.run(async (tx): Promise<Done> => {
      const draft = await drafts.get(taskId);
      if (!draft.ok) return draft;
      if (draft.value.revision !== revision) {
        return err(
          appError('conflict', 'The draft changed since it was shown', {
            reason: 'draft-changed',
          }),
        );
      }
      const all = await bindings.all();
      if (!all.ok) return all;
      const sites = sitesOf(draft.value, all.value);
      const target = targetOf(sites);
      if (target.conflict) {
        return err(
          appError('conflict', 'The steps belong to different projects', {
            reason: 'projects-differ',
          }),
        );
      }
      const chosen = project ?? target.project;
      if (chosen === null)
        return err(
          appError('validation', 'Choose a project for this task', {
            reason: 'project-required',
          }),
        );
      if (target.project !== null && target.project.id !== chosen.id) {
        return err(
          appError('conflict', `These pages are bound to ${target.project.name}`, {
            projectId: target.project.id,
            projectName: target.project.name,
            reason: 'bound-elsewhere',
          }),
        );
      }

      const frozen = await assembler.frozen(taskId);
      if (!frozen.ok) return frozen;
      const now = clock.now();
      const task = sendDraft(
        draft.value,
        {
          id: DeliveryId.parse(ids.next()),
          projectId: chosen.id,
          projectName: chosen.name,
          digest: frozen.value.bundle.digest,
        },
        now,
      );
      if (!task.ok) return task;

      tx.saveDraft(draft.value, null);
      tx.saveTask(null, task.value);
      const current = await active.get();
      if (current.ok && current.value === taskId) tx.setActive(null);

      // Settings, not the workspace: bound once the task is saved, so a failed send binds nothing.
      const unbound = new Set(
        sites.filter((site) => site.binding === null).map((site) => site.origin),
      );
      tx.afterCommit(async () => {
        let bound = 0;
        for (const pattern of unbound) {
          const put = await bindings.put({
            pattern,
            projectId: chosen.id,
            projectName: chosen.name,
            createdAt: now,
          });
          if (put.ok) bound += 1;
          else this.deps.logger.error('Could not bind a site', { pattern, ...put.error });
        }
        if (bound > 0) this.publishSettingsChanged();
      });
      return ok({});
    });
    if (!queued.ok) return queued;
    void this.deps.outbox.run();
    return ok({});
  }

  private publishSettingsChanged(): void {
    const published = this.deps.events.publish('settings.changed', {});
    if (!published.ok)
      this.deps.logger.error('Could not publish settings.changed', { ...published.error });
  }
}

export interface DeliveryActionDeps {
  readonly tasks: TaskRepository;
  readonly outbox: DeliverQueued;
  readonly writer: WorkspaceWriter;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Sends a refused task again as a new delivery, or moves a waiting one's next attempt to now. */
export class RetryDelivery {
  constructor(private readonly deps: DeliveryActionDeps) {}

  async execute(taskId: TaskId): Promise<Done> {
    const { writer, ids, clock } = this.deps;
    const updated = await writer.updateTask(taskId, (task) => {
      const now = clock.now();
      return task.state.kind === 'queued'
        ? rescheduleDelivery(task, now, now)
        : retryDelivery(task, DeliveryId.parse(ids.next()), now);
    });
    if (!updated.ok) return updated;
    void this.deps.outbox.run();
    return ok({});
  }
}

/** Turns a refused task back into the active draft, to edit it and send it again. */
export class ReopenDraft {
  constructor(private readonly deps: DeliveryActionDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, writer, clock } = this.deps;
    return writer.run(async (tx) => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const draft = reopenDraft(task.value, clock.now());
      if (!draft.ok) return draft;
      tx.saveTask(task.value, null);
      tx.saveDraft(null, draft.value);
      tx.setActive(draft.value.id);
      return ok({});
    });
  }
}
