import type { Instant, RunId, TaskId } from '../domain/ids';
import {
  corroborate,
  finishRun,
  interruptRun,
  startRun,
  type Run,
  type RunOutcome,
} from '../domain/run';
import {
  applyOutcome,
  awaitCredential,
  beginRun,
  fixBase,
  loseRun,
  runKindOf,
  type Task,
  type TransitionResult,
} from '../domain/task';
import type { CredentialVault, ModelAccessPolicy, Project, ProjectCatalog } from '../ports/access';
import type { CredentialKind } from '../domain/grant';
import type { AgentRunner, RunSpec } from '../ports/agent';
import type { BundleReader } from '../ports/bundles';
import type { SourceRepository } from '../ports/publishing';
import type { Clock, IdGenerator, Logger } from '../ports/system';
import type { TaskQueries, UnitOfWork } from '../ports/tasks';
import { composeBrief } from './brief';
import { projectGone, withProject } from './projects';
import { closeRun } from './runs';
import type { TaskWriter } from './task-writer';

/** How starting a run went. */
type Launch =
  | { readonly kind: 'started' }
  /** The run ended before the agent began, e.g. the repository could not be read. */
  | { readonly kind: 'ended'; readonly outcome: RunOutcome }
  /** The task moved on while the run was being prepared (it was cancelled): nothing to start. */
  | { readonly kind: 'superseded' };

/**
 * Drives a task's runs: starts a run for a queued task and waits for its outcome, or attaches to
 * the run of a running task (after a restart). Every step is recorded before it is taken, so a
 * supervisor that dies anywhere leaves a state the next one continues from, and the agent is
 * never started twice for one run.
 */
export class SuperviseRun {
  constructor(
    private readonly deps: {
      readonly queries: TaskQueries;
      readonly uow: UnitOfWork;
      readonly writer: TaskWriter;
      readonly projects: ProjectCatalog;
      readonly bundles: BundleReader;
      readonly source: SourceRepository;
      readonly runner: AgentRunner;
      readonly vault: CredentialVault;
      readonly access: ModelAccessPolicy;
      readonly ids: IdGenerator;
      readonly clock: Clock;
      readonly logger: Logger;
    },
  ) {}

  async handle(taskId: TaskId, signal: AbortSignal): Promise<void> {
    const task = await this.deps.queries.get(taskId);
    if (task === null) return;
    const runId =
      task.state.kind === 'queued'
        ? await this.start(task)
        : task.state.kind === 'running'
          ? task.state.runId
          : null;
    if (runId !== null) await this.supervise(taskId, runId, signal);
  }

  /** Starts a run; returns its id when the agent is running, or null when there is nothing to wait for. */
  private async start(task: Task): Promise<RunId | null> {
    const log = this.deps.logger.child({ taskId: task.id });
    const project = this.deps.projects.get(task.projectId);
    if (project === null) {
      await this.deps.writer.update(task.id, projectGone);
      return null;
    }
    const credential =
      task.credentials === 'operator'
        ? this.deps.access.operator
        : await this.deps.vault.held(task.id);
    if (credential === null) {
      log.info('Waiting for the requester’s credential');
      await this.deps.writer.update(task.id, (current, now) => awaitCredential(current, now));
      return null;
    }

    // A paused session goes on only where the runner can resume it as it was left.
    const paused = task.state.kind === 'queued' ? task.state.resumeFrom : null;
    const resumable =
      paused !== null && (await this.deps.runner.resumable(paused, project.execution))
        ? paused
        : null;
    if (paused !== null && resumable === null) {
      log.info('The paused session cannot be resumed: the run starts over', {
        image: paused.image,
        model: paused.model,
      });
    }

    const runId = this.deps.ids.run();
    const begun = await this.deps.writer.update(
      task.id,
      (current, now) => beginRun(current, runId, resumable, now),
      async (scope, transition) => {
        await scope.runs.insert(
          startRun({
            id: runId,
            taskId: task.id,
            kind: runKindOf(transition.task),
            image: project.execution.image,
            model: project.execution.model,
            startedAt: transition.event?.at ?? this.deps.clock.now(),
          }),
        );
        const terms = { runId, taskId: task.id } as const;
        return {
          setup: await scope.grants.issue({
            ...terms,
            phase: 'setup',
            hosts: project.execution.setupHosts,
          }),
          agent: await scope.grants.issue({
            ...terms,
            phase: 'agent',
            model: project.execution.model,
            credentials: task.credentials,
            budget: project.execution.budget,
          }),
        };
      },
    );
    if (!begun.ok || begun.value.extra === undefined) {
      log.info('The task was not ready to run', {
        reason: begun.ok ? 'no grant' : begun.error.message,
      });
      return null;
    }

    const launch = await this.launch(begun.value.transition.task, runId, project, {
      grants: begun.value.extra,
      credential,
    });
    switch (launch.kind) {
      case 'started':
        return runId;
      case 'ended':
        await this.settle(
          task.id,
          runId,
          (current, of, now) => applyOutcome(current, runId, launch.outcome, of.policy, now),
          (run, applied, at) => finishRun(run, launch.outcome, applied, at),
        );
        return null;
      case 'superseded':
        await this.deps.uow.run((scope) =>
          closeRun(scope, runId, (run) => interruptRun(run, this.deps.clock.now())),
        );
        return null;
    }
  }

  /** Fixes the base commit and starts the agent. */
  private async launch(
    task: Task,
    runId: RunId,
    project: Project,
    access: { readonly grants: RunSpec['grants']; readonly credential: CredentialKind },
  ): Promise<Launch> {
    const ended = (
      reason: Extract<RunOutcome, { kind: 'failed' }>['reason'],
      detail: string,
    ): Launch => ({
      kind: 'ended',
      outcome: { kind: 'failed', reason, detail, snapshot: null },
    });

    let baseSha = task.baseSha;
    if (baseSha === null) {
      const prepared = await this.deps.source.prepare(project.repository, task.id);
      if (!prepared.ok)
        return ended(
          prepared.error.transient ? 'infra' : 'repository-unavailable',
          prepared.error.detail,
        );
      const fixed = await this.deps.writer.update(task.id, (current, now) =>
        fixBase(current, runId, prepared.value.baseSha, now),
      );
      if (!fixed.ok) return { kind: 'superseded' };
      baseSha = fixed.value.transition.task.baseSha ?? prepared.value.baseSha;
    }

    const bundle = await this.deps.bundles.read(task.bundle.manifest);
    if (bundle === null) return ended('agent-failed', 'the bundle is no longer stored');
    const started = await this.deps.runner.start({
      runId,
      taskId: task.id,
      project: project.id,
      repository: project.repository,
      baseSha,
      brief: composeBrief(task, bundle, project),
      resumeFrom: task.state.kind === 'running' ? task.state.resumedFrom : null,
      grants: access.grants,
      credential: access.credential,
      execution: project.execution,
    });
    return started.ok
      ? { kind: 'started' }
      : ended(started.error.transient ? 'infra' : 'agent-failed', started.error.detail);
  }

  private async supervise(taskId: TaskId, runId: RunId, signal: AbortSignal): Promise<void> {
    const run = await this.deps.uow.run((scope) => scope.runs.get(runId));
    if (run?.state.kind !== 'started') return;
    const observed = await this.deps.runner.observe(runId, signal, {
      // The agent never holds what the setup used: its registries' grant ends with the setup.
      setupDone: () => this.deps.uow.run((scope) => scope.grants.revoke(runId, 'setup')),
    });
    // Shutting down: the run goes on, and the job's next delivery attaches to it again.
    if (signal.aborted) return;
    if (observed.kind === 'lost') {
      await this.settle(
        taskId,
        runId,
        (current, project, now) => loseRun(current, runId, observed.detail, project.policy, now),
        (lost, _applied, at) => interruptRun(lost, at),
      );
    } else {
      // The sandbox's account, as far as the gateway's refusal of the run bears it out.
      const refusal = await this.deps.uow.run((scope) => scope.grants.refusal(runId));
      const outcome = corroborate(observed, refusal);
      await this.settle(
        taskId,
        runId,
        (current, project, now) => applyOutcome(current, runId, outcome, project.policy, now),
        (finished, applied, at) => finishRun(finished, outcome, applied, at),
      );
    }
    await this.deps.runner.release(runId);
  }

  /**
   * Ends a run: the task moves when the run is still its current one, and the run is closed
   * either way. An outcome of a superseded run is kept, marked as not applied.
   */
  private async settle(
    taskId: TaskId,
    runId: RunId,
    decide: (task: Task, project: Project, now: Instant) => TransitionResult,
    record: (run: Run, applied: boolean, at: Instant) => Run,
  ): Promise<void> {
    const settled = await this.deps.writer.update(
      taskId,
      withProject(this.deps.projects, decide),
      (scope, transition) =>
        closeRun(scope, runId, (run) =>
          record(run, true, transition.event?.at ?? this.deps.clock.now()),
        ),
    );
    if (!settled.ok) {
      await this.deps.uow.run((scope) =>
        closeRun(scope, runId, (run) => record(run, false, this.deps.clock.now())),
      );
    }
  }
}
