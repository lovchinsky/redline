import { X } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconButton } from './Button';

interface SheetProps {
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** Extra controls in the header, before the close button. */
  readonly actions?: ComponentChildren;
  readonly children: ComponentChildren;
}

/**
 * A full-height layer over the panel, as a modal dialog: focus moves in, Escape closes, and
 * focus returns to where it was.
 */
export const Sheet = ({ title, closeLabel, onClose, actions, children }: SheetProps) => {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  return (
    <div
      ref={dialog}
      class="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header class="sheet-header">
        <h2>{title}</h2>
        {actions}
        <IconButton label={closeLabel} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div class="sheet-body">{children}</div>
    </div>
  );
};
