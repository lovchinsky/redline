import { Keyboard, LassoSelect, Undo2 } from 'lucide-preact';
import type { Ref } from 'preact';
import { Button, IconButton } from '../kit/Button';
import { useTranslator } from '../shared/i18n';
import type { ComposerView } from './composer-messages';
import { PROBLEM_MESSAGES, describeResolution } from './copy';

export interface ComposerProps {
  readonly view: ComposerView;
  readonly comment: string;
  readonly commentRef: Ref<HTMLTextAreaElement>;
  readonly panelRef: Ref<HTMLFormElement>;
  readonly onCommentChange: (comment: string) => void;
  readonly onRemoveLastShape: () => void;
  readonly onPickWithKeyboard: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/** What was circled and what to change: the panel inside the composer frame. */
export const Composer = ({
  view,
  comment,
  commentRef,
  panelRef,
  onCommentChange,
  onRemoveLastShape,
  onPickWithKeyboard,
  onSubmit,
  onCancel,
}: ComposerProps) => {
  const t = useTranslator();
  const { committing } = view;

  return (
    <form
      ref={panelRef}
      class="composer"
      data-testid="composer"
      aria-label={t.text('overlayLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div class="composer-head">
        <span class="composer-count">
          <LassoSelect size={15} aria-hidden="true" />
          {t.count('areaCount', view.shapes.length)}
        </span>
        <span class="composer-tools">
          <IconButton
            label={t.text('chooseWithKeyboard')}
            onClick={onPickWithKeyboard}
            disabled={committing}
          >
            <Keyboard size={15} />
          </IconButton>
          <IconButton
            label={t.text('removeLastShape')}
            onClick={onRemoveLastShape}
            disabled={committing}
          >
            <Undo2 size={15} />
          </IconButton>
        </span>
      </div>
      <ul class="shapes" data-testid="shape-summaries">
        {view.shapes.map((resolution, index) => (
          <li key={index}>{describeResolution(t, resolution)}</li>
        ))}
      </ul>
      <textarea
        ref={commentRef}
        class="textarea"
        data-testid="comment"
        aria-label={t.text('commentLabel')}
        value={comment}
        placeholder={t.text('commentPlaceholder')}
        disabled={committing}
        onInput={(event) => {
          onCommentChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {view.problem !== null && (
        <p class="alert" role="alert" data-testid="problem">
          {t.text(PROBLEM_MESSAGES[view.problem])}
        </p>
      )}
      <div class="composer-foot">
        <span class="composer-keys" aria-hidden="true">
          {t.text('composerKeys')}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={committing}>
          {t.text('cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          data-testid="submit"
          disabled={committing}
        >
          {committing ? t.text('savingStep') : t.text('saveStep')}
        </Button>
      </div>
    </form>
  );
};
