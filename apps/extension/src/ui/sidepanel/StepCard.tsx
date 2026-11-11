import { MAX_COMMENT_LENGTH, type TaskId } from '@redline/core';
import type { StepView } from '@redline/rpc';
import { ArrowDown, ArrowUp, Pencil, Trash } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { LocalFiles } from '../../ports/drafts';
import { Button, IconButton } from '../kit/Button';
import { InlineConfirm } from '../kit/InlineConfirm';
import { useTranslator } from '../shared/i18n';
import { StepItem } from './StepItem';
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
    <StepItem
      position={position}
      page={step.page}
      comment={step.comment}
      image={step.thumbnail === null ? null : { kind: 'asset', id: step.thumbnail.id }}
      files={files}
      tools={
        draft === null &&
        !confirming && (
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
        )
      }
      editor={
        draft === null ? undefined : (
          <div class="step-edit">
            <textarea
              class="textarea"
              aria-label={t.text('stepCommentLabel')}
              maxLength={MAX_COMMENT_LENGTH}
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
        )
      }
    >
      {confirming && (
        <InlineConfirm
          question={t.text('confirmRemoveStep')}
          confirmLabel={t.text('removeStep')}
          cancelLabel={t.text('cancel')}
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            actions.removeStep(taskId, step.id);
          }}
        />
      )}
    </StepItem>
  );
};
