import { outcomesOf, slicesOf, solvedShare, type CaseOutcome, type ScoredCase } from './cases';

const percent = (share: number): string => `${(share * 100).toFixed(1)}%`;

const rate = (outcomes: readonly CaseOutcome[]): string =>
  `${percent(solvedShare(outcomes))} (${String(outcomes.filter((o) => o.solved).length)}/${String(
    outcomes.length,
  )})`;

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** What the gate requires: the share of cases overall, and of every slice. */
export interface Targets {
  readonly overall: number;
  readonly slice: number;
}

/** Markdown: the metric, its slices, how early the useful anchor comes, and every build. */
export const renderReport = (scored: readonly ScoredCase[], targets: Targets): string => {
  const outcomes = outcomesOf(scored);
  const firstIsUseful = outcomes.filter((o) => o.rank === 1).length / Math.max(1, outcomes.length);
  const lines = [
    '# Anchor quality',
    '',
    `Cases where, on every build, one of the top 5 anchors searched verbatim finds only the right file: **${rate(outcomes)}** (target ${percent(targets.overall)}, every slice at least ${percent(targets.slice)}).`,
    '',
    `The first anchor already does it in ${percent(firstIsUseful)} of cases.`,
    '',
    '| Slice | Solved |',
    '| --- | --- |',
    ...slicesOf(outcomes).map(([slice, group]) => {
      const share = solvedShare(group);
      return `| ${slice} | ${rate(group)}${share < targets.slice ? ' **below the floor**' : ''} |`;
    }),
    '',
    '| Case | Build | Solved | Top anchors (→ files found) |',
    '| --- | --- | --- | --- |',
    ...scored.map(({ app, mode, case: evalCase, score }) => {
      const anchors = score.verdicts
        .map(
          ({ anchor, matches, hit }) =>
            `${hit ? '✅' : '·'} ${anchor.kind} \`${cell(anchor.value)}\` → ${
              matches.length === 0 ? 'nothing' : matches.join(', ')
            }`,
        )
        .join('<br>');
      return `| ${app.name}/${evalCase.id} | ${mode} | ${score.hit ? 'yes' : '**no**'} | ${anchors || 'no anchors'} |`;
    }),
    '',
  ];
  return `${lines.join('\n')}\n`;
};
