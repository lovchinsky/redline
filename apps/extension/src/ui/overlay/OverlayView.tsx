import type { Rect, Size } from '@redline/geometry';
import { useTranslator } from '../shared/i18n';
import type { CaptureState } from './capture-machine';
import { Composer } from './Composer';

export interface OverlayViewProps {
  readonly state: CaptureState;
  readonly anchor: Rect | null;
  readonly viewport: Size;
  /** Label of the element keyboard picking is on. */
  readonly cursor: string | null;
  readonly onPickWithKeyboard: () => void;
  readonly onCommentChange: (comment: string) => void;
  readonly onRemoveLastShape: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export const OverlayView = ({ state, anchor, cursor, ...handlers }: OverlayViewProps) => {
  const t = useTranslator();
  if (state.kind === 'armed') {
    return (
      <div class="hint" role="status" data-testid="hint">
        {t.text('overlayArmedHint')}
      </div>
    );
  }
  if (state.kind === 'picking') {
    return (
      <div class="hint" data-testid="hint">
        <span>{t.text('overlayKeyboardHint')}</span>
        {/* Announced on every move, so screen reader users hear where the cursor is. */}
        <span class="cursor" role="status" aria-live="polite" data-testid="cursor">
          {cursor === null ? '' : t.text('overlayKeyboardCurrent', cursor)}
        </span>
      </div>
    );
  }
  if ((state.kind === 'composing' || state.kind === 'committing') && anchor !== null) {
    return <Composer state={state} anchor={anchor} {...handlers} />;
  }
  return null;
};
