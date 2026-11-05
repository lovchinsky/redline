/** A keyboard shortcut as key caps, e.g. `Alt+Shift+A` or Chrome's macOS form `⌥⇧A`. */
export const Shortcut = ({ keys }: { keys: string }) => {
  const caps = keys.includes('+')
    ? keys.split('+')
    : Array.from(new Intl.Segmenter().segment(keys), (part) => part.segment);
  return (
    <span class="kbd-group" aria-label={keys}>
      {caps.map((key, index) => (
        <kbd key={`${key}-${String(index)}`} class="kbd" aria-hidden="true">
          {key}
        </kbd>
      ))}
    </span>
  );
};
