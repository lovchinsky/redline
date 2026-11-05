import { useCallback, useRef } from 'preact/hooks';

/**
 * For loads that can overlap (a change is announced while the previous load still runs): each
 * load calls `begin()` and, after every await, asks the returned `isLatest()` whether a newer
 * load has started since. Only the latest one may apply its result, so an answer that arrives
 * late never overwrites a newer one.
 */
export const useLatestLoad = (): (() => () => boolean) => {
  const generation = useRef(0);
  return useCallback(() => {
    const mine = ++generation.current;
    return () => mine === generation.current;
  }, []);
};
