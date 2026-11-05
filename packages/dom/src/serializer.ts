import { structuralSignature } from './describe';
import type { DomQuery } from './dom-query';

export interface SerializeOptions {
  /** Levels below the root that are expanded; deeper content becomes a count comment. */
  readonly maxDepth: number;
  /** Approximate output budget in characters. */
  readonly maxLength: number;
  readonly maxTextLength: number;
  /** Consecutive siblings with the same structure kept before the rest are summarized. */
  readonly keepRepeats: number;
  /** Elements to mark with `data-redline="selected"`. */
  readonly marked: ReadonlySet<Element>;
  /** Elements left out entirely (e.g. the capture overlay). */
  readonly skip: (element: Element) => boolean;
}

export const DEFAULT_SERIALIZE_OPTIONS: SerializeOptions = {
  maxDepth: 4,
  maxLength: 4096,
  maxTextLength: 120,
  keepRepeats: 2,
  marked: new Set(),
  skip: () => false,
};

export interface SerializedDom {
  readonly html: string;
  readonly truncated: boolean;
}

const DROPPED_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'link', 'meta']);
const OPAQUE_ELEMENTS = new Set(['svg', 'canvas', 'video', 'audio', 'iframe', 'object', 'embed']);
const VOID_ELEMENTS = new Set(['img', 'input', 'br', 'hr', 'source', 'wbr', 'area', 'col']);
const KEPT_ATTRIBUTES = new Set([
  'id',
  'class',
  'role',
  'name',
  'type',
  'href',
  'alt',
  'title',
  'placeholder',
  'for',
]);
const TEST_ID_ATTRIBUTES = new Set([
  'data-testid',
  'data-test',
  'data-test-id',
  'data-cy',
  'data-qa',
]);
const MAX_ATTRIBUTE_LENGTH = 80;

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shorten = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/**
 * Serializes an element subtree into compact, safe HTML for an agent to read.
 * Never emits form values, scripts, styles or media content; follows the flat tree
 * (open shadow roots, slots); collapses long runs of identical siblings; respects a budget.
 */
export const serializeElement = (
  dom: DomQuery,
  root: Element,
  options: SerializeOptions = DEFAULT_SERIALIZE_OPTIONS,
): SerializedDom => {
  const lines: string[] = [];
  const budget = { used: 0, exceeded: false };

  const emit = (depth: number, text: string): boolean => {
    if (budget.used + text.length > options.maxLength) {
      budget.exceeded = true;
      return false;
    }
    const line = `${'  '.repeat(depth)}${text}`;
    lines.push(line);
    budget.used += line.length + 1;
    return true;
  };

  const attributesOf = (element: Element): string => {
    const parts: string[] = [];
    for (const { name, value } of Array.from(element.attributes)) {
      const keep =
        KEPT_ATTRIBUTES.has(name) || TEST_ID_ATTRIBUTES.has(name) || name.startsWith('aria-');
      if (keep) parts.push(`${name}="${escapeHtml(shorten(value, MAX_ATTRIBUTE_LENGTH))}"`);
    }
    if (options.marked.has(element)) parts.push('data-redline="selected"');
    return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
  };

  const ownText = (element: Element): string =>
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const visit = (element: Element, depth: number): boolean => {
    const tag = element.localName;
    if (DROPPED_ELEMENTS.has(tag) || options.skip(element)) return true;
    const open = `<${tag}${attributesOf(element)}`;
    if (OPAQUE_ELEMENTS.has(tag) || VOID_ELEMENTS.has(tag)) return emit(depth, `${open} />`);
    if (tag === 'textarea' || tag === 'select') return emit(depth, `${open}></${tag}>`);

    const text = ownText(element);
    const children = dom.childrenOf(element);
    const textHtml = text === '' ? '' : escapeHtml(shorten(text, options.maxTextLength));
    if (children.length === 0) return emit(depth, `${open}>${textHtml}</${tag}>`);
    if (depth >= options.maxDepth) {
      return emit(
        depth,
        `${open}>${textHtml}<!-- ${String(children.length)} children --></${tag}>`,
      );
    }

    if (!emit(depth, `${open}>`)) return false;
    if (textHtml !== '' && !emit(depth + 1, textHtml)) return false;
    if (!visitChildren(children, depth + 1)) return false;
    return emit(depth, `</${tag}>`);
  };

  const visitChildren = (children: readonly Element[], depth: number): boolean => {
    let previousSignature: string | null = null;
    let run = 0;
    let skipped = 0;
    const flushSkipped = (): boolean => {
      if (skipped === 0) return true;
      const ok = emit(depth, `<!-- …and ${String(skipped)} more like the above -->`);
      skipped = 0;
      return ok;
    };
    for (const child of children) {
      const signature = structuralSignature(dom, child);
      run = signature === previousSignature ? run + 1 : 1;
      previousSignature = signature;
      if (run > options.keepRepeats && !options.marked.has(child)) {
        skipped += 1;
        continue;
      }
      if (!flushSkipped() || !visit(child, depth)) return false;
    }
    return flushSkipped();
  };

  visit(root, 0);
  if (budget.exceeded) lines.push('<!-- truncated -->');
  return { html: lines.join('\n'), truncated: budget.exceeded };
};
