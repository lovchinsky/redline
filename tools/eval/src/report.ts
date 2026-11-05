import type { BuildMode } from './build';
import type { CorpusApp } from './corpus';
import type { CaseMeasurement } from './measure';
import type { CaseScore } from './score';

export interface ScoredCase extends CaseMeasurement {
  readonly app: CorpusApp;
  readonly mode: BuildMode;
  readonly score: CaseScore;
}

const percent = (part: number, whole: number): string =>
  whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`;

const rate = (cases: readonly ScoredCase[]): string =>
  `${percent(cases.filter((c) => c.score.hit).length, cases.length)} (${String(
    cases.filter((c) => c.score.hit).length,
  )}/${String(cases.length)})`;

const groupBy = <K extends string>(
  cases: readonly ScoredCase[],
  key: (scored: ScoredCase) => K,
): [K, ScoredCase[]][] => {
  const groups = new Map<K, ScoredCase[]>();
  for (const scored of cases) groups.set(key(scored), [...(groups.get(key(scored)) ?? []), scored]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
};

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown: the metric, its breakdowns, and every case with the anchors it produced. */
export const renderReport = (cases: readonly ScoredCase[], target: number): string => {
  const solved = cases.filter((c) => c.score.hit).length;
  const lines = [
    '# Anchor quality',
    '',
    `Cases where one of the top 5 anchors, searched verbatim, finds only the right file: **${rate(cases)}** (target ${percent(target, 1)}).`,
    '',
    '| Slice | Solved |',
    '| --- | --- |',
    ...[
      ...groupBy(cases, (c) => `framework: ${c.app.framework}`),
      ...groupBy(cases, (c) => `styling: ${c.app.styling}`),
      ...groupBy(cases, (c) => `i18n: ${c.app.i18n ? 'yes' : 'no'}`),
      ...groupBy(cases, (c) => `build: ${c.mode}`),
    ].map(([slice, group]) => `| ${slice} | ${rate(group)} |`),
    '',
    '| Case | Build | Solved | Top anchors (→ files found) |',
    '| --- | --- | --- | --- |',
    ...cases.map(({ app, mode, case: evalCase, score }) => {
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
  return `${lines.join('\n')}\n<!-- ${String(solved)} of ${String(cases.length)} -->\n`;
};
