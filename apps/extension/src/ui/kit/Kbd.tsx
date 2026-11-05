/**
 * A keyboard shortcut as key caps, e.g. `Alt+Shift+A` or Chrome's macOS form `⌥⇧A`. The caps
 * are for the eye; screen readers read the shortcut once, as written.
 */
export const Shortcut = ({ keys }: { keys: string }) => {
  const caps = keys.includes('+')
    ? keys.split('+')
    : Array.from(new Intl.Segmenter().segment(keys), (part) => part.segment);
  return (
    <span class="kbd-group">
      <span class="sr-only">{keys}</span>
      {caps.map((key, index) => (
        <kbd key={`${key}-${String(index)}`} class="kbd" aria-hidden="true">
          {key}
        </kbd>
      ))}
    </span>
  );
};
