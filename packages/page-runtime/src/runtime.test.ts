import { createElement as h, type FC, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h as vh } from 'vue';
import { PageRuntimeClient } from './client';
import { REQUEST_EVENT, RESPONSE_EVENT } from './protocol';
import { traceComponents } from './probes';
import { startPageRuntime } from './runtime';

let n = 0;
const client = new PageRuntimeClient(document, () => `req-${String(++n)}`);

const container = () => {
  const element = document.createElement('div');
  document.body.append(element);
  return element;
};

describe('before the runtime starts', () => {
  it('reports that nobody answers', () => {
    expect(client.ping()).toEqual({ ok: false, failure: { kind: 'no-runtime' } });
  });

  it('rejects an answer that is not the runtime’s', () => {
    const forge = (event: Event) => {
      const id = (JSON.parse((event as CustomEvent<string>).detail) as { id: string }).id;
      document.dispatchEvent(
        new CustomEvent(RESPONSE_EVENT, {
          detail: JSON.stringify({ id, ok: true, result: { version: 'x' } }),
        }),
      );
    };
    document.addEventListener(REQUEST_EVENT, forge);
    const result = client.ping();
    document.removeEventListener(REQUEST_EVENT, forge);
    expect(result).toMatchObject({ ok: false, failure: { kind: 'invalid-response' } });
  });
});

describe('page runtime', () => {
  beforeAll(() => {
    startPageRuntime(window, 'capture-start');
    startPageRuntime(window, 'page-load'); // a second injection changes nothing
  });

  it('answers once, whatever the number of injections', () => {
    let responses = 0;
    const count = () => {
      responses += 1;
    };
    document.addEventListener(RESPONSE_EVENT, count);
    expect(client.ping()).toEqual({
      ok: true,
      value: { version: 1, observedSince: 'capture-start' },
    });
    document.removeEventListener(RESPONSE_EVENT, count);
    expect(responses).toBe(1);
  });

  it('traces React components that render an element, innermost first', () => {
    const Badge: FC = () => h('span', { className: 'badge' }, 'Most popular');
    const PlanCard: FC<{ children?: ReactNode }> = () => h('article', null, h(Badge));
    const PricingPage: FC = () => h('main', null, h(PlanCard));
    const root = container();
    flushSync(() => {
      createRoot(root).render(h(PricingPage));
    });
    const badge = root.querySelector('.badge');
    if (badge === null) throw new Error('not rendered');

    const trace = client.componentTrace(badge);
    expect(trace).toMatchObject({
      ok: true,
      value: { framework: 'react', mode: 'development' },
    });
    if (!trace.ok || trace.value === null) return;
    expect(trace.value.components.map((c) => c.name)).toEqual(['Badge', 'PlanCard', 'PricingPage']);
  });

  it('traces Vue components with the app version', () => {
    const Badge = defineComponent({ name: 'Badge', render: () => vh('span', { class: 'vbadge' }) });
    const PlanCard = defineComponent({
      name: 'PlanCard',
      render: () => vh('article', [vh(Badge)]),
    });
    const root = container();
    createApp({ name: 'PricingPage', render: () => vh(PlanCard) }).mount(root);
    const badge = root.querySelector('.vbadge');
    if (badge === null) throw new Error('not rendered');

    const trace = client.componentTrace(badge);
    if (!trace.ok || trace.value === null) throw new Error(JSON.stringify(trace));
    expect(trace.value.framework).toBe('vue');
    expect(trace.value.version).toMatch(/^3\./);
    expect(trace.value.components.map((c) => c.name)).toEqual(['Badge', 'PlanCard', 'PricingPage']);
  });

  it('reaches elements inside open shadow roots', () => {
    const host = container();
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p>Inside</p>';
    const inner = shadow.querySelector('p');
    if (inner === null) throw new Error('fixture');
    Object.assign(inner, {
      __svelte_meta: { loc: { file: 'src/lib/Widget.svelte', line: 12, column: 3 } },
    });
    const trace = client.componentTrace(inner);
    expect(trace).toMatchObject({
      ok: true,
      value: {
        framework: 'svelte',
        components: [{ name: 'Widget', file: 'src/lib/Widget.svelte', line: 12 }],
      },
    });
  });

  it('answers not-applicable (null) for production builds and plain markup', () => {
    const minified = container();
    Object.assign(minified, {
      __reactFiber$x1: { type: 'div', return: { type: function e() {}, return: null } },
    });
    expect(client.componentTrace(minified)).toEqual({ ok: true, value: null });
    expect(client.componentTrace(container())).toEqual({ ok: true, value: null });
  });

  it('reports the runtime state of the page', () => {
    expect(client.runtimeReport()).toMatchObject({
      ok: true,
      value: { observedSince: 'capture-start', errors: [], failedRequests: [] },
    });
  });
});

describe('probes', () => {
  it('survive internals they do not expect', () => {
    const hostile = document.createElement('div');
    Object.defineProperty(hostile, '__reactFiber$boom', {
      enumerable: true,
      get: () => {
        throw new Error('getter trap');
      },
    });
    expect(traceComponents(hostile, window)).toBeNull();
  });

  it('follow Angular components through the ng debugging helpers', () => {
    class PlanCardComponent {
      readonly selector = 'app-plan-card';
    }
    class PricingPageComponent {
      readonly selector = 'app-pricing';
    }
    const page = document.createElement('app-pricing');
    const card = document.createElement('app-plan-card');
    const button = document.createElement('button');
    page.append(card);
    card.append(button);
    const owners = new Map<unknown, object>([
      [button, new PlanCardComponent()],
      [page, new PricingPageComponent()],
    ]);
    const hosts = new Map<object, Element>();
    for (const [element, component] of owners) {
      hosts.set(component, element === button ? card : document.createElement('app-root'));
    }
    const view = {
      document,
      ng: {
        getOwningComponent: (target: unknown) => owners.get(target) ?? null,
        getHostElement: (component: object) => hosts.get(component) ?? null,
      },
    } as unknown as Window;
    expect(traceComponents(button, view)?.components.map((c) => c.name)).toEqual([
      'PlanCardComponent',
      'PricingPageComponent',
    ]);
  });
});
