import type { DomQuery } from './dom-query';
import { isGeneratedToken, semanticClasses } from './tokens';

const MAX_LABEL = 60;

/** Short human-readable label: `button.cta`, `section#pricing`, `div[data-testid=plan-card]`. */
export const describeElement = (element: Element): string => {
  const tag = element.localName;
  const testId = element.getAttribute('data-testid');
  const id = element.id;
  const label =
    testId !== null && testId !== ''
      ? `${tag}[data-testid=${testId}]`
      : id !== '' && !isGeneratedToken(id)
        ? `${tag}#${id}`
        : (() => {
            const [first] = semanticClasses(element);
            return first === undefined ? tag : `${tag}.${first}`;
          })();
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
};

const MAX_CHILD_TAGS = 8;

/**
 * Structure fingerprint used to group repeated siblings (cards, list items):
 * tag, authored classes, and the tags of the first children.
 */
export const structuralSignature = (dom: DomQuery, element: Element): string => {
  const classes = semanticClasses(element).sort().join('.');
  const childTags = dom
    .childrenOf(element)
    .slice(0, MAX_CHILD_TAGS)
    .map((child) => child.localName)
    .join(',');
  return `${element.localName}.${classes}>${childTags}`;
};
