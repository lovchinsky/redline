import { useTranslator } from '../shared/i18n';
import type { CaptureState } from './capture-machine';

export interface OverlayViewProps {
  readonly state: CaptureState;
  /** Label of the element keyboard picking is on. */
  readonly cursor: string | null;
}

/** The overlay's hint at the top of the page; the composer has a frame of its own. */
export const OverlayView = ({ state, cursor }: OverlayViewProps) => {
  const t = useTranslator();
  if (state.kind === 'armed') {
    return (
      <div class="hint" role="status" data-testid="hint">
        <span class="hint-line">{t.text('overlayArmedHint')}</span>
      </div>
    );
  }
  if (state.kind === 'picking') {
    return (
      <div class="hint" data-testid="hint">
        <span class="hint-line">{t.text('overlayKeyboardHint')}</span>
        {/* Announced on every move, so screen reader users hear where the cursor is. */}
        <span class="cursor" role="status" aria-live="polite" data-testid="cursor">
          {cursor === null ? '' : t.text('overlayKeyboardCurrent', cursor)}
        </span>
      </div>
    );
  }
  return null;
};
