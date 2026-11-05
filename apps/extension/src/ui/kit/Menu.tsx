import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly onSelect: () => void;
  readonly icon?: ComponentChildren;
  /** Secondary text on the right, e.g. a count. */
  readonly meta?: string;
  /** For a choice among items: rendered as a checked radio item. */
  readonly checked?: boolean;
  readonly danger?: boolean;
  readonly testId?: string;
}

export type MenuEntry = MenuItem | 'separator';

interface MenuProps {
  /** Renders the trigger; spread the props onto a button. */
  readonly trigger: (props: {
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  }) => ComponentChildren;
  readonly items: readonly MenuEntry[];
  readonly label: string;
  readonly align?: 'start' | 'end';
}

const itemsOf = (popover: HTMLElement | null): HTMLElement[] =>
  popover === null ? [] : Array.from(popover.querySelectorAll<HTMLElement>('[role^="menuitem"]'));

/**
 * A WAI-ARIA menu button: opens with click, Enter, Space or the arrow keys; arrows, Home and End
 * move between items; Escape, Tab or a click outside closes it and focus returns to the trigger.
 */
export const Menu = ({ trigger, items, label, align = 'start' }: MenuProps) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const focusFirst = useRef<'first' | 'last' | null>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) root.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const all = itemsOf(popover.current);
    const target =
      focusFirst.current === 'last'
        ? all.at(-1)
        : (all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0]);
    target?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusFirst.current = event.key === 'ArrowUp' ? 'last' : 'first';
      setOpen(true);
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const all = itemsOf(popover.current);
    const index = all.indexOf(document.activeElement as HTMLElement);
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: (index + 1) % all.length,
      ArrowUp: (index - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      all[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div class="menu" ref={root}>
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => {
          focusFirst.current = 'first';
          setOpen((value) => !value);
        },
        onKeyDown: onTriggerKey,
      })}
      {open && (
        <div
          ref={popover}
          class="menu-popover"
          role="menu"
          aria-label={label}
          data-align={align}
          onKeyDown={onMenuKey}
        >
          {items.map((entry, index) =>
            entry === 'separator' ? (
              <div key={`separator-${String(index)}`} class="menu-separator" role="separator" />
            ) : (
              <button
                key={entry.key}
                type="button"
                class={entry.danger === true ? 'menu-item danger' : 'menu-item'}
                role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={entry.checked}
                tabIndex={-1}
                data-testid={entry.testId}
                onClick={() => {
                  close(true);
                  entry.onSelect();
                }}
              >
                {entry.checked === undefined ? (
                  entry.icon
                ) : (
                  <span class="menu-check" aria-hidden="true">
                    {entry.checked ? '●' : ''}
                  </span>
                )}
                <span class="menu-text">{entry.label}</span>
                {entry.meta !== undefined && <span class="menu-meta">{entry.meta}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};
