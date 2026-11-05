import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BUILD_MODES, OUTPUT_DIR, buildApp, buildHarness } from './build';
import { loadCorpus } from './corpus';
import { Measurer } from './measure';
import { outcomesOf, slicesOf, solvedShare, type ScoredCase } from './cases';
import { renderReport, type Targets } from './report';
import { scoreCase } from './score';

/**
 * The share of cases the anchors must solve (the spec's target), and the least any framework,
 * styling approach or i18n setup may solve on its own.
 */
const TARGETS: Targets = { overall: 0.8, slice: 0.6 };

const { values } = parseArgs({ options: { app: { type: 'string' } } });

const apps = await loadCorpus(values.app);
const measurer = await Measurer.launch(await buildHarness());
const scored: ScoredCase[] = [];
try {
  for (const app of apps) {
    for (const mode of BUILD_MODES) {
      const measurements = await measurer.measure(app, await buildApp(app, mode));
      for (const measurement of measurements) {
        scored.push({
          ...measurement,
          app,
          mode,
          score: scoreCase(measurement.result.anchors, app.sources, measurement.case.expect),
        });
      }
    }
  }
} finally {
  await measurer.close();
}

const report = renderReport(scored, TARGETS);
await mkdir(OUTPUT_DIR, { recursive: true });
const reportFile = path.join(OUTPUT_DIR, 'report.md');
await writeFile(reportFile, report);
process.stdout.write(report);

const outcomes = outcomesOf(scored);
const solved = solvedShare(outcomes);
if (solved < TARGETS.overall) {
  process.stderr.write(`Anchor quality ${(solved * 100).toFixed(1)}% is below the target.\n`);
  process.exitCode = 1;
}
for (const [slice, group] of slicesOf(outcomes)) {
  const share = solvedShare(group);
  if (share < TARGETS.slice) {
    process.stderr.write(`${slice}: ${(share * 100).toFixed(1)}% is below the slice floor.\n`);
    process.exitCode = 1;
  }
}
