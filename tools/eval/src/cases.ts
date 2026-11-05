import type { BuildMode } from './build';
import type { CorpusApp } from './corpus';
import type { CaseMeasurement } from './measure';
import type { CaseScore } from './score';

/** One case measured on one build of its app. */
export interface ScoredCase extends CaseMeasurement {
  readonly app: CorpusApp;
  readonly mode: BuildMode;
  readonly score: CaseScore;
}

/**
 * One case across the builds it was measured on. It counts once: solved only when its anchors
 * work on every build, since a person may circle either one.
 */
export interface CaseOutcome {
  readonly app: CorpusApp;
  readonly id: string;
  readonly builds: readonly ScoredCase[];
  readonly solved: boolean;
  /** The worst build's position of its first useful anchor (1 = first); null when unsolved. */
  readonly rank: number | null;
}

const firstHit = (scored: ScoredCase): number | null => {
  const index = scored.score.verdicts.findIndex((verdict) => verdict.hit);
  return index === -1 ? null : index + 1;
};

export const outcomesOf = (scored: readonly ScoredCase[]): CaseOutcome[] => {
  const byCase = new Map<string, ScoredCase[]>();
  for (const entry of scored) {
    const key = `${entry.app.name}/${entry.case.id}`;
    byCase.set(key, [...(byCase.get(key) ?? []), entry]);
  }
  return [...byCase].map(([key, builds]) => {
    const ranks = builds.map(firstHit).filter((rank) => rank !== null);
    const solved = ranks.length === builds.length;
    const [first] = builds;
    if (first === undefined) throw new Error(`No builds for ${key}`);
    return {
      app: first.app,
      id: first.case.id,
      builds,
      solved,
      rank: solved ? Math.max(...ranks) : null,
    };
  });
};

export const solvedShare = (outcomes: readonly CaseOutcome[]): number =>
  outcomes.length === 0 ? 0 : outcomes.filter((o) => o.solved).length / outcomes.length;

/** Slices whose own share must hold: a weak framework or styling cannot hide in the average. */
export const slicesOf = (outcomes: readonly CaseOutcome[]): [string, CaseOutcome[]][] => {
  const slices = new Map<string, CaseOutcome[]>();
  const add = (name: string, outcome: CaseOutcome) =>
    slices.set(name, [...(slices.get(name) ?? []), outcome]);
  for (const outcome of outcomes) {
    add(`framework: ${outcome.app.framework}`, outcome);
    add(`styling: ${outcome.app.styling}`, outcome);
    add(`i18n: ${outcome.app.i18n ? 'yes' : 'no'}`, outcome);
  }
  return [...slices].sort(([a], [b]) => a.localeCompare(b));
};
