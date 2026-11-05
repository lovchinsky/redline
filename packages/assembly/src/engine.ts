import {
  FragmentSet,
  appError,
  err,
  ok,
  runTaskProcessors,
  type AppError,
  type AssemblyStep,
  type Result,
  type StepCapture,
  type Task,
  type TaskProcessor,
} from '@redline/core';
import type { Bundle, Packager } from './packager';
import type { MarkdownContextRenderer } from './renderer';

export interface AssemblyRequest {
  readonly task: Task;
  /** Collected context of every step, by capture id. */
  readonly captures: ReadonlyMap<string, StepCapture>;
  /** ISO timestamp written to the manifest. */
  readonly createdAt: string;
  readonly clientVersion: string;
}

export interface Assembled {
  readonly bundle: Bundle;
  /** What could not be rendered (unknown fragment kinds…); the bundle is still valid. */
  readonly warnings: readonly string[];
}

export interface AssemblyEngineDeps {
  readonly processors: readonly TaskProcessor[];
  readonly renderer: MarkdownContextRenderer;
  readonly packager: Packager;
}

/**
 * Assembly pipeline: task processors → presenters and budget → packager. Used both for the
 * preview and for sending, so the user sees exactly what will be delivered.
 */
export class AssemblyEngine {
  constructor(private readonly deps: AssemblyEngineDeps) {}

  async assemble(request: AssemblyRequest): Promise<Result<Assembled, AppError>> {
    const { task } = request;
    if (task.steps.length === 0) {
      return err(appError('validation', 'A task without steps cannot be assembled'));
    }

    const initial: AssemblyStep[] = [];
    for (const step of task.steps) {
      const capture = request.captures.get(step.captureId);
      if (capture === undefined) {
        return err(appError('not-found', 'Context of a step is missing', { stepId: step.id }));
      }
      initial.push({
        id: step.id,
        shapeIds: step.shapeIds,
        fragments: FragmentSet.fromCapture(capture),
        references: [],
      });
    }

    const processed = runTaskProcessors(this.deps.processors, initial);
    if (processed.map((step) => step.id).join('\n') !== initial.map((s) => s.id).join('\n')) {
      return err(appError('internal', 'A task processor added, dropped or reordered steps'));
    }
    const rendered = this.deps.renderer.render({
      steps: task.steps.map((step, index) => ({
        id: step.id,
        comment: step.comment,
        shapeIds: step.shapeIds,
        fragments: processed[index]?.fragments.fragments ?? [],
        references: processed[index]?.references ?? [],
      })),
    });

    const bundle = await this.deps.packager.build({
      taskId: task.id,
      createdAt: request.createdAt,
      clientVersion: request.clientVersion,
      steps: task.steps.map((step) => ({
        id: step.id,
        url: step.page.url,
        routePattern: step.page.routePattern,
        comment: step.comment,
        viewport: step.viewport,
        shapeIds: step.shapeIds,
      })),
      rendered,
    });
    return bundle.ok ? ok({ bundle: bundle.value, warnings: rendered.warnings }) : bundle;
  }
}
