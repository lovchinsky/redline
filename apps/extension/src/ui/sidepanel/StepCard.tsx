import type { TaskId } from '@redline/core';
import type { StepView } from '@redline/rpc';
import { ArrowDown, ArrowUp, Pencil, Trash } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LocalFiles } from '../../ports/drafts';
import { Button, IconButton } from '../kit/Button';
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

/** Where the step was taken: host and route, the way a developer reads it. */
const placeOf = (url: string, routePattern: string): string =>
  `${new URL(url).host}${routePattern}`;

export const StepCard = ({ taskId, step, position, count, actions, files }: StepCardProps) => {
  const t = useTranslator();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);
  const title = t.text('stepTitle', t.number(position + 1));

  const save = () => {
    if (draft !== null && draft.trim() !== step.comment) {
      actions.editComment(taskId, step.id, draft);
    }
    setDraft(null);
  };

  return (
    <li class="step" data-testid="step" aria-label={title}>
      <span class="step-marker" aria-hidden="true">
        {position + 1}
      </span>
      <div class="step-main">
        <div class="step-head">
          <span class="step-place" title={step.page.title || step.page.url}>
            {placeOf(step.page.url, step.page.routePattern)}
          </span>
          {draft === null && !confirming && (
            <div class="step-tools" role="group" aria-label={title}>
              <IconButton
                label={t.text('edit')}
                onClick={() => {
                  setDraft(step.comment);
                }}
              >
                <Pencil size={14} />
              </IconButton>
              <IconButton
                label={t.text('moveUp')}
                disabled={position === 0}
                onClick={() => {
                  actions.moveStep(taskId, step.id, position - 1);
                }}
              >
                <ArrowUp size={14} />
              </IconButton>
              <IconButton
                label={t.text('moveDown')}
                disabled={position === count - 1}
                onClick={() => {
                  actions.moveStep(taskId, step.id, position + 1);
                }}
              >
                <ArrowDown size={14} />
              </IconButton>
              <IconButton
                label={t.text('removeStep')}
                danger
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <Trash size={14} />
              </IconButton>
            </div>
          )}
        </div>

        {draft === null ? (
          <p class="step-comment" data-testid="step-comment">
            {step.comment}
          </p>
        ) : (
          <div class="step-edit">
            <textarea
              class="textarea"
              aria-label={t.text('stepCommentLabel')}
              value={draft}
              rows={3}
              ref={editor}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save();
                if (event.key === 'Escape') setDraft(null);
              }}
            />
            <div class="confirm-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                }}
              >
                {t.text('cancel')}
              </Button>
              <Button size="sm" variant="primary" disabled={draft.trim() === ''} onClick={save}>
                {t.text('save')}
              </Button>
            </div>
          </div>
        )}

        {confirming && (
          <div class="confirm" role="alertdialog" aria-label={t.text('confirmRemoveStep')}>
            <span>{t.text('confirmRemoveStep')}</span>
            <div class="confirm-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t.text('cancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  actions.removeStep(taskId, step.id);
                }}
              >
                {t.text('removeStep')}
              </Button>
            </div>
          </div>
        )}

        {step.thumbnail !== null && (
          <LocalImage
            class="step-shot"
            files={files}
            source={{ kind: 'asset', id: step.thumbnail.id }}
            alt={t.text('stepScreenshot', t.number(position + 1))}
          />
        )}
      </div>
    </li>
  );
};
