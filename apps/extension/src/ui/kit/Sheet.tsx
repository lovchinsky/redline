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
 * A full-height layer over the panel: a native modal dialog, so the panel behind it is inert
 * (Tab and screen readers stay inside), Escape closes it, and focus returns to where it was.
 */
export const Sheet = ({ title, closeLabel, onClose, actions, children }: SheetProps) => {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      class="sheet"
      aria-label={title}
      onCancel={(event) => {
        // Escape: the owner decides, and unmounting closes the dialog.
        event.preventDefault();
        onClose();
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
    </dialog>
  );
};
