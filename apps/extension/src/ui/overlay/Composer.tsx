import type { Point, Rect, Size } from '@redline/geometry';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CaptureState } from './capture-machine';
import { useTranslator } from '../shared/i18n';
import { PROBLEM_MESSAGES, describeResolution } from './copy';
import { placePanel } from './placement';

export type ComposerState = Extract<CaptureState, { kind: 'composing' | 'committing' }>;

export interface ComposerProps {
  readonly state: ComposerState;
  /** Where the latest shape is on screen; the panel floats next to it. */
  readonly anchor: Rect;
  readonly viewport: Size;
  readonly onCommentChange: (comment: string) => void;
  readonly onRemoveLastShape: () => void;
  readonly onPickWithKeyboard: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export const Composer = ({
  state,
  anchor,
  viewport,
  onCommentChange,
  onRemoveLastShape,
  onPickWithKeyboard,
  onSubmit,
  onCancel,
}: ComposerProps) => {
  const t = useTranslator();
  const panel = useRef<HTMLFormElement>(null);
  const comment = useRef<HTMLTextAreaElement>(null);
  const [position, setPosition] = useState<Point | null>(null);
  const committing = state.kind === 'committing';

  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) return;
    setPosition(
      placePanel(anchor, { width: element.offsetWidth, height: element.offsetHeight }, viewport),
    );
  }, [anchor, viewport, state]);

  // A hidden element cannot take focus, so focus the comment once the panel is placed.
  const placed = position !== null;
  useEffect(() => {
    if (placed) comment.current?.focus();
  }, [placed]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      ref={panel}
      class="composer"
      data-testid="composer"
      data-placed={String(position !== null)}
      style={
        position === null
          ? undefined
          : { left: `${String(position.x)}px`, top: `${String(position.y)}px` }
      }
      aria-label={t.text('overlayLabel')}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div class="composer-head">
        <span>{t.count('areaCount', state.shapes.length)}</span>
        <span class="head-actions">
          <button type="button" class="link" onClick={onPickWithKeyboard} disabled={committing}>
            {t.text('chooseWithKeyboard')}
          </button>
          <button type="button" class="link" onClick={onRemoveLastShape} disabled={committing}>
            {t.text('removeLastShape')}
          </button>
        </span>
      </div>
      <ul class="shapes" data-testid="shape-summaries">
        {state.shapes.map((entry) => (
          <li key={entry.shape.id}>{describeResolution(t, entry.resolution)}</li>
        ))}
      </ul>
      <label>
        {t.text('commentLabel')}
        <textarea
          ref={comment}
          data-testid="comment"
          value={state.draft.comment}
          placeholder={t.text('commentPlaceholder')}
          disabled={committing}
          onInput={(event) => {
            onCommentChange(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {state.draft.problem !== null && (
        <p class="problem" role="alert" data-testid="problem">
          {t.text(PROBLEM_MESSAGES[state.draft.problem])}
        </p>
      )}
      <div class="actions">
        <button type="button" onClick={onCancel} disabled={committing}>
          {t.text('cancel')}
        </button>
        <button type="submit" class="primary" data-testid="submit" disabled={committing}>
          {committing ? t.text('savingStep') : t.text('saveStep')}
        </button>
      </div>
    </form>
  );
};
