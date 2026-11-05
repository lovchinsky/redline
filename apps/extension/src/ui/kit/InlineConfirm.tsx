import { useEffect, useId, useRef } from 'preact/hooks';
import { Button } from './Button';

interface InlineConfirmProps {
  readonly question: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Asks right where the action was started, without a dialog: focus moves to the safe answer,
 * so Enter never destroys anything by accident, and Escape takes the question back.
 */
export const InlineConfirm = ({
  question,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: InlineConfirmProps) => {
  const id = useId();
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The first button is the safe one.
    group.current?.querySelector('button')?.focus();
  }, []);
  return (
    <div
      ref={group}
      class="confirm"
      role="group"
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <span id={id}>{question}</span>
      <div class="confirm-actions">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="sm" variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
};
