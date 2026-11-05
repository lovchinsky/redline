import { captureContext, get, mount, shapeAround, stepOf } from '@redline/modules/testing';
import { describe, expect, it } from 'vitest';
import { shippedCapture } from './index';

/** The spec's budget: collecting a step, screenshot aside, within 300 ms at the 95th percentile. */
const P95_BUDGET_MS = 300;
const RUNS = 30;
const WARM_UP = 3;

const STATUSES = ['Paid', 'Pending', 'Refunded'] as const;

const repeat = (count: number, render: (index: number) => string): string =>
  Array.from({ length: count }, (_, index) => render(index)).join('');

/** A busy back-office page: navigation, a long table, a card grid and a sizeable stylesheet. */
const heavyPage = (): { html: string; css: string } => {
  const links = repeat(
    40,
    (i) => `<li><a href="/section/${String(i)}" class="nav-link">Section ${String(i)}</a></li>`,
  );
  const rows = repeat(400, (i) => {
    const status = STATUSES[i % STATUSES.length] ?? 'Paid';
    return `
      <tr class="order-row" data-testid="order-${String(i)}">
        <td class="cell id"><code>ORD-${String(10_000 + i)}</code></td>
        <td class="cell customer"><span class="avatar">C${String(i % 9)}</span> Customer ${String(i)}</td>
        <td class="cell total">${String(i * 3)}.00 USD</td>
        <td class="cell status"><span class="badge badge-${status.toLowerCase()}">${status}</span></td>
        <td class="cell actions"><button type="button" aria-label="Open order ${String(i)}">Open</button></td>
      </tr>`;
  });
  const cards = repeat(
    60,
    (i) => `
      <article class="card" data-testid="card-${String(i)}">
        <h3 class="card-title">Report ${String(i)}</h3>
        <p class="card-body">Weekly numbers for region ${String(i % 7)} with a short summary.</p>
        <footer class="card-footer"><a href="/reports/${String(i)}">Details</a></footer>
      </article>`,
  );
  const rules = repeat(
    300,
    (i) =>
      `.generated-${String(i)} { margin: ${String(i % 12)}px; padding: ${String(i % 5)}px; }\n`,
  );
  return {
    html: `
      <header class="topbar"><h1>Back office</h1><input type="search" name="q" placeholder="Search orders"></header>
      <div class="shell">
        <nav class="sidebar"><ul>${links}</ul></nav>
        <main class="content">
          <section class="cards">${cards}</section>
          <table class="orders"><tbody>${rows}</tbody></table>
        </main>
      </div>`,
    css: `
      .shell { display: grid; grid-template-columns: 220px 1fr; }
      .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
      .card { padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
      .orders { width: 100%; border-collapse: collapse; }
      .cell { padding: 6px; border-bottom: 1px solid #eee; }
      .badge { padding: 2px 6px; border-radius: 999px; }
      ${rules}`,
  };
};

const percentile = (samples: readonly number[], p: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

describe('capture pipeline performance', () => {
  it('collects a step on a heavy page within budget (p95, no screenshot)', async () => {
    const { html, css } = heavyPage();
    mount(html, css);
    expect(document.querySelectorAll('*').length).toBeGreaterThan(4000);

    const { plan, engine } = shippedCapture(
      { now: () => performance.now() },
      (collector) => collector !== 'screenshot',
    );
    // Two areas on screen, as people usually circle: a row of cards and part of the menu.
    const step = stepOf('Align the cards with the menu', [
      shapeAround('cards', [get('[data-testid=card-0]'), get('[data-testid=card-3]')]),
      shapeAround('menu', [get('.sidebar li:nth-child(2)'), get('.sidebar li:nth-child(6)')]),
    ]);

    const samples: number[] = [];
    for (let run = 0; run < WARM_UP + RUNS; run += 1) {
      const { capture, report } = await engine.run(plan, step, captureContext());
      expect(capture.diagnostics.filter((d) => d.outcome === 'failed')).toEqual([]);
      if (run >= WARM_UP) samples.push(report.durationMs);
    }

    const p95 = percentile(samples, 95);
    console.info(
      `capture pipeline: p50 ${percentile(samples, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
    );
    expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});
