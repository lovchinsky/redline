import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

interface TabsProps<Id extends string> {
  readonly label: string;
  readonly tabs: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
  readonly children: ComponentChildren;
}

/**
 * WAI-ARIA tabs: one tab stop for the tab list, arrow keys, Home and End move between tabs,
 * and the panel is labelled by its tab.
 */
export const Tabs = <Id extends string>({
  label,
  tabs,
  selected,
  onSelect,
  children,
}: TabsProps<Id>) => {
  const list = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (tab === undefined) return;
    onSelect(tab.id);
    list.current?.querySelector<HTMLElement>(`#tab-${tab.id}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const current = tabs.findIndex((tab) => tab.id === selected);
    const moves: Readonly<Record<string, number>> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  };

  return (
    <>
      <div ref={list} class="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map(({ id, label: tabLabel }) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            data-testid={`tab-${id}`}
            aria-selected={selected === id}
            aria-controls={`panel-${id}`}
            tabIndex={selected === id ? 0 : -1}
            onClick={() => {
              onSelect(id);
            }}
          >
            {tabLabel}
          </button>
        ))}
      </div>
      <div id={`panel-${selected}`} role="tabpanel" aria-labelledby={`tab-${selected}`}>
        {children}
      </div>
    </>
  );
};
