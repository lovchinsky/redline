import type { RegionSummary } from '@redline/dom';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_CONFIG,
  initialCaptureState,
  transition,
  type CaptureEvent,
  type CaptureState,
  type Transition,
} from './capture-machine';

const summary: RegionSummary = {
  kind: 'elements',
  groups: [{ label: 'div.card', count: 3 }],
  container: 'div.grid',
  neighbors: [],
};

const context = () => {
  let n = 0;
  return { ids: { next: () => `shape-${String((n += 1))}` }, config: DEFAULT_MACHINE_CONFIG };
};

/** Runs events in order and returns the final transition plus every effect emitted. */
const run = (events: readonly CaptureEvent[], from: CaptureState = initialCaptureState()) => {
  const ctx = context();
  let last: Transition = { state: from, effects: [] };
  const effects: Transition['effects'][number][] = [];
  for (const event of events) {
    last = transition(last.state, event, ctx);
    effects.push(...last.effects);
  }
  return { state: last.state, effects };
};

const scroll = { x: 0, y: 100 };
const lasso: CaptureEvent[] = [
  { type: 'pointer-down', point: { x: 10, y: 10 }, scroll },
  { type: 'pointer-move', point: { x: 110, y: 10 } },
  { type: 'pointer-move', point: { x: 110, y: 110 } },
  { type: 'pointer-move', point: { x: 10, y: 110 } },
  { type: 'pointer-up', point: { x: 12, y: 12 } },
];
const resolved = (polygon = [{ x: 0, y: 0 }]): CaptureEvent => ({
  type: 'shape-resolved',
  shapeId: 'shape-1',
  polygon,
  summary,
});
const fillDraft: CaptureEvent[] = [
  { type: 'comment-changed', comment: '  Make the cards equal height  ' },
];

describe('capture state machine', () => {
  it('turns a drawn lasso into a shape and asks for its resolution', () => {
    const { state, effects } = run(lasso);

    expect(state.kind).toBe('composing');
    if (state.kind !== 'composing') return;
    expect(state.shapes).toHaveLength(1);
    expect(state.shapes[0]?.shape).toMatchObject({ id: 'shape-1', source: 'lasso', scroll });
    expect(state.shapes[0]?.resolution).toEqual({ status: 'pending' });
    expect(effects).toEqual([{ type: 'resolve-shape', shape: state.shapes[0]?.shape }]);
  });

  it('treats a tiny stroke as a click', () => {
    const { effects } = run([
      { type: 'pointer-down', point: { x: 50, y: 50 }, scroll },
      { type: 'pointer-up', point: { x: 52, y: 51 } },
    ]);
    expect(effects[0]).toMatchObject({
      type: 'resolve-shape',
      shape: { source: 'click', polygon: [{ x: 52, y: 51 }] },
    });
  });

  it('drops pointer samples that are too close together', () => {
    const { state } = run([
      { type: 'pointer-down', point: { x: 0, y: 0 }, scroll },
      { type: 'pointer-move', point: { x: 0.5, y: 0.5 } },
      { type: 'pointer-move', point: { x: 5, y: 0 } },
    ]);
    expect(state.kind === 'drawing' ? state.stroke : null).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
  });

  it('applies resolution results, including a replaced outline', () => {
    const outline = [
      { x: 1, y: 1 },
      { x: 9, y: 1 },
      { x: 9, y: 9 },
    ];
    const { state } = run([...lasso, resolved(outline)]);
    expect(state.kind === 'composing' ? state.shapes[0] : null).toMatchObject({
      shape: { polygon: outline },
      resolution: { status: 'resolved', summary },
    });
  });

  it('collects several shapes into one step', () => {
    const second: CaptureEvent[] = lasso.map((event) =>
      event.type === 'pointer-down' ? { ...event, point: { x: 300, y: 300 } } : event,
    );
    const { state } = run([...lasso, resolved(), ...second]);
    expect(state.kind === 'composing' ? state.shapes.map((s) => s.shape.id) : []).toEqual([
      'shape-1',
      'shape-2',
    ]);
  });

  describe('submit', () => {
    it('commits a complete draft with the trimmed comment', () => {
      const { state, effects } = run([...lasso, resolved(), ...fillDraft, { type: 'submit' }]);
      expect(state.kind).toBe('committing');
      expect(effects.at(-1)).toMatchObject({
        type: 'commit',
        submission: { comment: 'Make the cards equal height' },
      });
    });

    it.each([
      [[...lasso, ...fillDraft], 'resolution-pending'],
      [[...lasso, resolved(), { type: 'comment-changed', comment: '   ' }], 'comment-required'],
      [
        [
          ...lasso,
          { type: 'shape-resolved', shapeId: 'shape-1', polygon: [], summary: null },
          ...fillDraft,
        ],
        'empty-shape',
      ],
    ] as [CaptureEvent[], string][])('refuses an incomplete draft (%#: %s)', (events, problem) => {
      const { state, effects } = run([...events, { type: 'submit' }]);
      expect(state.kind).toBe('composing');
      expect(state.kind === 'composing' ? state.draft.problem : null).toBe(problem);
      expect(effects.some((effect) => effect.type === 'commit')).toBe(false);
    });

    it('clears a reported problem as soon as the draft changes', () => {
      const { state } = run([...lasso, resolved(), { type: 'submit' }, ...fillDraft]);
      expect(state.kind === 'composing' ? state.draft.problem : 'x').toBeNull();
    });
  });

  describe('commit outcome', () => {
    const committing = [...lasso, resolved(), ...fillDraft, { type: 'submit' } as const];

    it('closes after a successful commit', () => {
      const { state, effects } = run([...committing, { type: 'commit-succeeded' }]);
      expect(state).toEqual({ kind: 'closed', outcome: 'committed' });
      expect(effects.at(-1)).toEqual({ type: 'close' });
    });

    it('returns to composing with the draft kept after a failed commit', () => {
      const { state } = run([...committing, { type: 'commit-failed' }]);
      expect(state.kind).toBe('composing');
      if (state.kind !== 'composing') return;
      expect(state.draft).toMatchObject({
        comment: '  Make the cards equal height  ',
        problem: 'commit-failed',
      });
    });

    it('ignores input while committing', () => {
      const { state } = run([...committing, { type: 'escape' }, ...lasso]);
      expect(state.kind).toBe('committing');
    });
  });

  describe('escape', () => {
    it('cancels the stroke being drawn and keeps earlier shapes', () => {
      const { state } = run([
        ...lasso,
        resolved(),
        { type: 'pointer-down', point: { x: 1, y: 1 }, scroll },
        { type: 'escape' },
      ]);
      expect(state.kind).toBe('composing');
      expect(state.kind === 'composing' ? state.shapes : []).toHaveLength(1);
    });

    it('discards the step from composing, then closes from armed', () => {
      const discarded = run([...lasso, ...fillDraft, { type: 'escape' }]);
      expect(discarded.state).toEqual(initialCaptureState());
      const closed = run([{ type: 'escape' }]);
      expect(closed.state).toEqual({ kind: 'closed', outcome: 'cancelled' });
      expect(closed.effects).toEqual([{ type: 'close' }]);
    });
  });

  it('goes back to armed when the last shape is removed, keeping the draft', () => {
    const { state } = run([...lasso, resolved(), ...fillDraft, { type: 'remove-last-shape' }]);
    expect(state.kind).toBe('armed');
    expect(state.kind === 'armed' ? state.draft.comment : '').toContain('equal height');
  });

  it('stops adding shapes at the configured limit', () => {
    const many = Array.from({ length: DEFAULT_MACHINE_CONFIG.maxShapes + 2 }, () => lasso).flat();
    const { state } = run(many);
    expect(state.kind === 'composing' ? state.shapes : []).toHaveLength(
      DEFAULT_MACHINE_CONFIG.maxShapes,
    );
  });

  describe('keyboard picking', () => {
    const box = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 20 },
      { x: 0, y: 20 },
    ];
    const pick: CaptureEvent[] = [
      { type: 'keyboard-start' },
      { type: 'element-picked', box, scroll },
    ];

    it('turns the chosen element into a shape, like a drawn one', () => {
      const { state, effects } = run(pick);
      expect(state.kind).toBe('composing');
      const shape = { id: 'shape-1', source: 'keyboard', polygon: box, scroll };
      expect(state.kind === 'composing' ? state.shapes.map((entry) => entry.shape) : []).toEqual([
        shape,
      ]);
      expect(effects).toEqual([{ type: 'resolve-shape', shape }]);
    });

    it('adds further elements from the composer and keeps the comment', () => {
      const { state } = run([...lasso, ...fillDraft, ...pick]);
      expect(state.kind === 'composing' ? state.shapes.map((e) => e.shape.source) : []).toEqual([
        'lasso',
        'keyboard',
      ]);
      expect(state.kind === 'composing' ? state.draft.comment : '').toContain('equal height');
    });

    it('leaves picking on escape without adding anything', () => {
      expect(run([{ type: 'keyboard-start' }, { type: 'escape' }]).state.kind).toBe('armed');
      const back = run([...lasso, { type: 'keyboard-start' }, { type: 'escape' }]).state;
      expect(back.kind === 'composing' ? back.shapes : []).toHaveLength(1);
    });

    it('ignores pointer input while picking', () => {
      const { state } = run([{ type: 'keyboard-start' }, ...lasso]);
      expect(state.kind).toBe('picking');
    });
  });
});
