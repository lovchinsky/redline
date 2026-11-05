import type { TaskId } from '@redline/core';
import type { StepView } from '@redline/rpc';
import { useState } from 'preact/hooks';
import type { LocalFiles } from '../../ports/drafts';
import { useTranslator } from '../shared/i18n';
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
  const t = useTranslator();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const title = t.text('stepTitle', t.number(position + 1));

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
            aria-label={t.text('stepCommentLabel')}
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
              {t.text('edit')}
            </button>
          ) : (
            <button type="button" disabled={draft.trim() === ''} onClick={save}>
              {t.text('save')}
            </button>
          )}
          <button
            type="button"
            aria-label={t.text('moveUp')}
            title={t.text('moveUp')}
            disabled={position === 0}
            onClick={() => {
              actions.moveStep(taskId, step.id, position - 1);
            }}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={t.text('moveDown')}
            title={t.text('moveDown')}
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
                {t.text('removeStep')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t.text('cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={t.text('removeStep')}
              title={t.text('removeStep')}
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
