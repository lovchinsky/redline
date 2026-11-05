import { INTENTS, type Intent } from '@redline/core';
import type { Point, Rect, Size } from '@redline/geometry';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CaptureState } from './capture-machine';
import { INTENT_LABELS } from '../shared/copy';
import { PROBLEM_MESSAGES, UI_TEXT, describeResolution } from './copy';
import { placePanel } from './placement';

export type ComposerState = Extract<CaptureState, { kind: 'composing' | 'committing' }>;

export interface ComposerProps {
  readonly state: ComposerState;
  /** Where the latest shape is on screen; the panel floats next to it. */
  readonly anchor: Rect;
  readonly viewport: Size;
  readonly onCommentChange: (comment: string) => void;
  readonly onIntentSelect: (intent: Intent) => void;
  readonly onRemoveLastShape: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export const Composer = ({
  state,
  anchor,
  viewport,
  onCommentChange,
  onIntentSelect,
  onRemoveLastShape,
  onSubmit,
  onCancel,
}: ComposerProps) => {
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
      aria-label="Redline"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div class="composer-head">
        <span>{UI_TEXT.shapesTitle(state.shapes.length)}</span>
        <button type="button" class="link" onClick={onRemoveLastShape} disabled={committing}>
          {UI_TEXT.removeLastShape}
        </button>
      </div>
      <ul class="shapes" data-testid="shape-summaries">
        {state.shapes.map((entry) => (
          <li key={entry.shape.id}>{describeResolution(entry.resolution)}</li>
        ))}
      </ul>
      <label>
        {UI_TEXT.commentLabel}
        <textarea
          ref={comment}
          data-testid="comment"
          value={state.draft.comment}
          placeholder={UI_TEXT.commentPlaceholder}
          disabled={committing}
          onInput={(event) => {
            onCommentChange(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <fieldset disabled={committing}>
        <legend>{UI_TEXT.intentLabel}</legend>
        {INTENTS.map((intent) => (
          <label key={intent} class="chip">
            <input
              type="radio"
              name="intent"
              value={intent}
              data-testid={`intent-${intent}`}
              checked={state.draft.intent === intent}
              onChange={() => {
                onIntentSelect(intent);
              }}
            />
            {INTENT_LABELS[intent]}
          </label>
        ))}
      </fieldset>
      {state.draft.problem !== null && (
        <p class="problem" role="alert" data-testid="problem">
          {PROBLEM_MESSAGES[state.draft.problem]}
        </p>
      )}
      <div class="actions">
        <button type="button" onClick={onCancel} disabled={committing}>
          {UI_TEXT.cancel}
        </button>
        <button type="submit" class="primary" data-testid="submit" disabled={committing}>
          {committing ? UI_TEXT.submitting : UI_TEXT.submit}
        </button>
      </div>
    </form>
  );
};
