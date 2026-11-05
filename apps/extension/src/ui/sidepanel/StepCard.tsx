import type { TaskId } from '@redline/core';
import type { StepView } from '@redline/rpc';
import { useState } from 'preact/hooks';
import type { LocalFiles } from '../../ports/drafts';
import { PANEL_TEXT } from './copy';
import { LocalImage } from './LocalImage';
import type { DraftActions } from './use-drafts';

interface StepCardProps {
  readonly taskId: TaskId;
  readonly step: StepView;
  readonly position: number;
  readonly count: number;
  readonly actions: DraftActions;
  readonly files: LocalFiles;
}

export const StepCard = ({ taskId, step, position, count, actions, files }: StepCardProps) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const title = PANEL_TEXT.stepTitle(position + 1);

  const save = () => {
    if (draft !== null && draft.trim() !== step.comment) {
      actions.editComment(taskId, step.id, draft);
    }
    setDraft(null);
  };

  return (
    <li class="step" data-testid="step" aria-label={title}>
      {step.thumbnail === null ? (
        <div class="thumb placeholder" aria-hidden="true" />
      ) : (
        <LocalImage
          class="thumb"
          files={files}
          source={{ kind: 'asset', id: step.thumbnail.id }}
          alt=""
        />
      )}
      <div class="step-body">
        <h3>{title}</h3>
        <p class="muted page" title={step.page.url}>
          {step.page.title || step.page.routePattern} · <code>{step.page.routePattern}</code>
        </p>
        {draft === null ? (
          <p class="comment" data-testid="step-comment">
            {step.comment}
          </p>
        ) : (
          <textarea
            aria-label={PANEL_TEXT.commentLabel}
            value={draft}
            rows={3}
            onInput={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
              if (event.key === 'Escape') setDraft(null);
            }}
          />
        )}
        <div class="actions">
          {draft === null ? (
            <button
              type="button"
              onClick={() => {
                setDraft(step.comment);
              }}
            >
              {PANEL_TEXT.edit}
            </button>
          ) : (
            <button type="button" disabled={draft.trim() === ''} onClick={save}>
              {PANEL_TEXT.save}
            </button>
          )}
          <button
            type="button"
            aria-label={PANEL_TEXT.moveUp}
            title={PANEL_TEXT.moveUp}
            disabled={position === 0}
            onClick={() => {
              actions.moveStep(taskId, step.id, position - 1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={PANEL_TEXT.moveDown}
            title={PANEL_TEXT.moveDown}
            disabled={position === count - 1}
            onClick={() => {
              actions.moveStep(taskId, step.id, position + 1);
            }}
          >
            ↓
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                class="danger"
                onClick={() => {
                  actions.removeStep(taskId, step.id);
                }}
              >
                {PANEL_TEXT.removeStep}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {PANEL_TEXT.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={PANEL_TEXT.removeStep}
              title={PANEL_TEXT.removeStep}
              onClick={() => {
                setConfirming(true);
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </li>
  );
};
