import type { Intent } from '@redline/core';
import type { Rect, Size } from '@redline/geometry';
import type { CaptureState } from './capture-machine';
import { Composer } from './Composer';
import { UI_TEXT } from './copy';

export interface OverlayViewProps {
  readonly state: CaptureState;
  readonly anchor: Rect | null;
  readonly viewport: Size;
  readonly onCommentChange: (comment: string) => void;
  readonly onIntentSelect: (intent: Intent) => void;
  readonly onRemoveLastShape: () => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export const OverlayView = ({ state, anchor, ...handlers }: OverlayViewProps) => {
  if (state.kind === 'armed') {
    return (
      <div class="hint" role="status" data-testid="hint">
        {UI_TEXT.armedHint}
      </div>
    );
  }
  if ((state.kind === 'composing' || state.kind === 'committing') && anchor !== null) {
    return <Composer state={state} anchor={anchor} {...handlers} />;
  }
  return null;
};
