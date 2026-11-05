/**
 * The overlay's only footprint in the page: one element holding a closed shadow root.
 * Page styles cannot reach in and page scripts cannot read its markup; the host never
 * intercepts hit-testing except on the drawing canvas while drawing is possible. A closed
 * shadow root does not hide events, so what the user types goes into the composer frame,
 * a document of the extension's own origin (see composer-frame.ts).
 */
export class OverlayHost {
  static readonly TAG = 'redline-overlay';

  private constructor(
    private readonly host: HTMLElement,
    readonly canvas: HTMLCanvasElement,
    readonly ui: HTMLElement,
  ) {}

  static mount(document: Document, css: string): OverlayHost {
    const host = document.createElement(OverlayHost.TAG);
    // CSSOM writes are not subject to the page's style-src CSP, unlike style attributes.
    for (const [property, value] of Object.entries(HOST_STYLE)) {
      host.style.setProperty(property, value, 'important');
    }
    const shadow = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];

    const canvas = document.createElement('canvas');
    canvas.className = 'canvas';
    const ui = document.createElement('div');
    ui.className = 'ui';
    shadow.append(canvas, ui);
    document.documentElement.append(host);
    return new OverlayHost(host, canvas, ui);
  }

  /** True for the host element: what the page's hit-testing reports for anything inside it. */
  owns(element: Element): boolean {
    return element === this.host;
  }

  /** Whether the canvas takes pointer input (drawing) or lets it pass through to the page. */
  setDrawingEnabled(enabled: boolean): void {
    this.canvas.dataset['drawing'] = String(enabled);
  }

  /** Hides the whole overlay, e.g. so a screenshot shows the page without it. */
  setVisible(visible: boolean): void {
    this.host.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
  }

  /** Keeps keyboard and pointer events from the overlay away from page handlers. */
  isolateEvents(types: readonly string[]): () => void {
    const stop = (event: Event) => {
      event.stopPropagation();
    };
    for (const type of types) this.host.addEventListener(type, stop);
    return () => {
      for (const type of types) this.host.removeEventListener(type, stop);
    };
  }

  remove(): void {
    this.host.remove();
  }
}

const HOST_STYLE: Readonly<Record<string, string>> = {
  all: 'initial',
  position: 'fixed',
  inset: '0',
  'z-index': '2147483647',
  'pointer-events': 'none',
  display: 'block',
};
