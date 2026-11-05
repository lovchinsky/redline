import {
  appError,
  err,
  ok,
  originPatternOf,
  queueForDelivery,
  reopenDraft,
  rescheduleDelivery,
  resolveBinding,
  retryDelivery,
  type AppError,
  type Binding,
  type Clock,
  type Logger,
  type Result,
  type Task,
  type TaskId,
} from '@redline/core';
import type { AppEvents, DeliveryTarget, EventPublisher, ProjectRef } from '@redline/rpc';
import type { BindingStore } from '../../ports/delivery';
import type { ActiveDraftStore, TaskRepository } from '../../ports/drafts';
import type { BundleAssembler } from '../drafts/assemble-bundle';
import type { TaskWriter } from '../tasks/task-writer';
import type { DeliverQueued } from './deliver-queued';

type Done = Result<Record<string, never>, AppError>;

interface StepSite {
  readonly origin: string;
  readonly binding: Binding | null;
}

/** The site of every step and the binding that applies to the step's page. */
const sitesOf = (task: Task, bindings: readonly Binding[]): StepSite[] =>
  task.steps.map((step) => {
    const url = new URL(step.page.url);
    return { origin: originPatternOf(url), binding: resolveBinding(bindings, url) };
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
  return {
    sites: [...unique.values()],
    project: projects.size === 1 ? (only ?? null) : null,
    conflict: projects.size > 1,
  };
};

export interface SubmitTaskDeps {
  readonly tasks: TaskRepository;
  readonly active: ActiveDraftStore;
  readonly bindings: BindingStore;
  readonly assembler: BundleAssembler;
  readonly outbox: DeliverQueued;
  readonly writer: TaskWriter;
  readonly events: EventPublisher<AppEvents>;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Which project a draft would go to, from the bindings of the pages its steps were taken on. */
export class ResolveDeliveryTarget {
  constructor(private readonly deps: Pick<SubmitTaskDeps, 'tasks' | 'bindings'>) {}

  async execute(taskId: TaskId): Promise<Result<DeliveryTarget, AppError>> {
    const [task, bindings] = await Promise.all([
      this.deps.tasks.get(taskId),
      this.deps.bindings.all(),
    ]);
    if (!task.ok) return task;
    if (!bindings.ok) return bindings;
    return ok(targetOf(sitesOf(task.value, bindings.value)));
  }
}

/**
 * Sends a draft: binds its unbound sites to the chosen project, freezes its bundle (the one the
 * preview showed) and puts it in the outbox. The draft stops being active, so the next circled
 * step starts a new one. Delivery itself happens in the outbox, right away or later.
 */
export class SubmitTask {
  constructor(private readonly deps: SubmitTaskDeps) {}

  async execute(taskId: TaskId, project: ProjectRef | null): Promise<Done> {
    const { tasks, active, bindings, assembler, writer, clock } = this.deps;
    const queued = await writer.run(
      async (): Promise<Result<{ boundSites: boolean }, AppError>> => {
        const task = await tasks.get(taskId);
        if (!task.ok) return task;
        const all = await bindings.all();
        if (!all.ok) return all;
        const sites = sitesOf(task.value, all.value);
        const target = targetOf(sites);
        if (target.conflict) {
          return err(appError('conflict', 'The steps belong to different projects'));
        }
        const chosen = project ?? target.project;
        if (chosen === null) return err(appError('validation', 'Choose a project for this task'));
        if (target.project !== null && target.project.id !== chosen.id) {
          return err(
            appError('conflict', `These pages are bound to ${target.project.name}`, {
              projectId: target.project.id,
            }),
          );
        }

        const frozen = await assembler.frozen(taskId);
        if (!frozen.ok) return frozen;
        const now = clock.now();
        const next = queueForDelivery(
          task.value,
          { projectId: chosen.id, projectName: chosen.name, digest: frozen.value.bundle.digest },
          now,
        );
        if (!next.ok) return next;

        const unbound = new Set(
          sites.filter((site) => site.binding === null).map((site) => site.origin),
        );
        for (const pattern of unbound) {
          const bound = await bindings.put({
            pattern,
            projectId: chosen.id,
            projectName: chosen.name,
            createdAt: now,
          });
          if (!bound.ok) return bound;
        }
        const saved = await tasks.save(next.value);
        if (!saved.ok) return saved;
        const current = await active.get();
        if (current.ok && current.value === taskId) {
          const cleared = await active.set(null);
          if (!cleared.ok) return cleared;
        }
        await writer.announce({ taskId, before: task.value, after: next.value });
        return ok({ boundSites: unbound.size > 0 });
      },
    );
    if (!queued.ok) return queued;
    if (queued.value.boundSites) this.publishSettingsChanged();
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
  readonly active: ActiveDraftStore;
  readonly outbox: DeliverQueued;
  readonly writer: TaskWriter;
  readonly clock: Clock;
}

/** Sends a refused task again, or moves a waiting one's next attempt to now. */
export class RetryDelivery {
  constructor(private readonly deps: DeliveryActionDeps) {}

  async execute(taskId: TaskId): Promise<Done> {
    const { tasks, writer, clock } = this.deps;
    const result = await writer.run(async (): Promise<Done> => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const now = clock.now();
      const next =
        task.value.state.kind === 'queued'
          ? rescheduleDelivery(task.value, now, now)
          : retryDelivery(task.value, now);
      if (!next.ok) return next;
      const saved = await tasks.save(next.value);
      if (!saved.ok) return saved;
      await writer.announce({ taskId, before: task.value, after: next.value });
      return ok({});
    });
    if (result.ok) void this.deps.outbox.run();
    return result;
  }
}

/** Turns a refused task back into the active draft, to edit it and send it again. */
export class ReopenDraft {
  constructor(private readonly deps: DeliveryActionDeps) {}

  execute(taskId: TaskId): Promise<Done> {
    const { tasks, active, writer, clock } = this.deps;
    return writer.run(async () => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      const next = reopenDraft(task.value, clock.now());
      if (!next.ok) return next;
      const saved = await tasks.save(next.value);
      if (!saved.ok) return saved;
      const activated = await active.set(taskId);
      if (!activated.ok) return activated;
      await writer.announce({ taskId, before: task.value, after: next.value });
      return ok({});
    });
  }
}
