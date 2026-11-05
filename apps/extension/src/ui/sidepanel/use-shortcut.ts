import { useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';

/** The capture shortcut as the user has it; `undefined` while loading, `null` when unset. */
export const useCaptureShortcut = (services: UiServices): string | null | undefined => {
  const [shortcut, setShortcut] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void services.shortcut.current().then((value) => {
      if (live) setShortcut(value);
    });
    return () => {
      live = false;
    };
  }, [services]);
  return shortcut;
};
