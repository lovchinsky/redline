/** Small facts about one element that several readers of the page share. */

/** The element's own text, not its children's, with whitespace collapsed. */
export const ownText = (element: Element): string =>
  Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Attributes test suites use to find elements; developers write them by hand. */
export const TEST_ID_ATTRIBUTES: readonly string[] = [
  'data-testid',
  'data-test',
  'data-test-id',
  'data-cy',
  'data-qa',
];

/** The element's first non-empty test id, with the attribute that carries it. */
export const testIdOf = (
  element: Element,
): { readonly attribute: string; readonly value: string } | null => {
  for (const attribute of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(attribute)?.trim();
    if (value) return { attribute, value };
  }
  return null;
};
