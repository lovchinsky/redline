import {
  ok,
  sameTarget,
  type AppError,
  type AssetRef,
  type Draft,
  type FragmentCatalog,
  type Result,
  type Step,
  type StepCapture,
  type TaskId,
} from '@redline/core';
import type { DraftSummary, DraftView, StepView } from '@redline/rpc';
import type { ActiveDraftStore, DraftRepository } from '../../ports/workspace';
import type { StoredCaptures } from './stored-captures';

export interface DraftQueryDeps {
  readonly drafts: DraftRepository;
  readonly active: ActiveDraftStore;
  readonly captures: StoredCaptures;
  readonly catalog: FragmentCatalog;
}

const summaryOf = (draft: Draft): DraftSummary => ({
  id: draft.id,
  title: draft.title,
  firstComment: draft.steps[0]?.comment ?? null,
  stepCount: draft.steps.length,
  updatedAt: draft.updatedAt,
});

/** Drafts, most recently changed first, and the one new steps go to. */
export class ListDrafts {
  constructor(private readonly deps: DraftQueryDeps) {}

  async execute(): Promise<
    Result<{ activeId: TaskId | null; drafts: readonly DraftSummary[] }, AppError>
  > {
    const [all, active] = await Promise.all([this.deps.drafts.list(), this.deps.active.get()]);
    if (!all.ok) return all;
    if (!active.ok) return active;
    const drafts = [...all.value].sort((a, b) => b.updatedAt - a.updatedAt).map(summaryOf);
    const activeId = drafts.some((draft) => draft.id === active.value) ? active.value : null;
    return ok({ activeId, drafts });
  }
}

/** One draft with its steps, as the side panel shows it. */
export class GetDraft {
  constructor(private readonly deps: DraftQueryDeps) {}

  async execute(taskId: TaskId): Promise<Result<DraftView, AppError>> {
    const draft = await this.deps.drafts.get(taskId);
    if (!draft.ok) return draft;
    const steps = await Promise.all(draft.value.steps.map((step) => this.viewOf(step)));
    return ok({
      id: draft.value.id,
      title: draft.value.title,
      revision: draft.value.revision,
      updatedAt: draft.value.updatedAt,
      steps,
    });
  }

  private async viewOf(step: Step): Promise<StepView> {
    const capture = await this.deps.captures.load(step.captureId);
    return {
      id: step.id,
      comment: step.comment,
      page: step.page,
      areaCount: step.shapeIds.length,
      capturedAt: step.capturedAt,
      // A step whose context cannot be read still lists; it just has no picture.
      thumbnail: capture.ok ? this.thumbnailOf(step, capture.value) : null,
    };
  }

  /** The first picture any presenter offers for the first circled area. */
  private thumbnailOf(step: Step, capture: StepCapture): AssetRef | null {
    const [firstShape] = step.shapeIds;
    for (const fragment of capture.fragments) {
      if (!sameTarget(fragment.target, { level: 'shape', shapeId: firstShape ?? '' })) continue;
      const thumbnail = this.deps.catalog.get(fragment.kind)?.presenter.thumbnail?.(fragment);
      if (thumbnail != null) return thumbnail;
    }
    return null;
  }
}
