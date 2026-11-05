import type { CDPSession, Page } from '@playwright/test';

/**
 * Reads and clicks inside the overlay's closed shadow root through the DevTools protocol,
 * which (unlike page scripts and Playwright locators) can see closed shadow roots.
 */
interface CdpNode {
  nodeId: number;
  localName?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
}

const findNode = (node: CdpNode, testId: string): CdpNode | null => {
  const attributes = node.attributes ?? [];
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === 'data-testid' && attributes[i + 1] === testId) return node;
  }
  for (const child of [...(node.shadowRoots ?? []), ...(node.children ?? [])]) {
    const found = findNode(child, testId);
    if (found !== null) return found;
  }
  return null;
};

export class OverlayProbe {
  private constructor(
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async attach(page: Page): Promise<OverlayProbe> {
    return new OverlayProbe(page, await page.context().newCDPSession(page));
  }

  /** Text of the element with the given test id, or null when it is not rendered. */
  async text(testId: string): Promise<string | null> {
    const node = await this.find(testId);
    if (node === null) return null;
    const { object } = (await this.cdp.send('DOM.resolveNode', { nodeId: node.nodeId })) as {
      object: { objectId: string };
    };
    const { result } = (await this.cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: 'function () { return this.textContent; }',
      returnByValue: true,
    })) as { result: { value: string } };
    return result.value;
  }

  async click(testId: string): Promise<void> {
    const node = await this.find(testId);
    if (node === null) throw new Error(`Overlay element ${testId} is not rendered`);
    const { model } = (await this.cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as {
      model: { content: number[] };
    };
    const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content;
    await this.page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  }

  private async find(testId: string): Promise<CdpNode | null> {
    const { root } = (await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as {
      root: CdpNode;
    };
    return findNode(root, testId);
  }
}
