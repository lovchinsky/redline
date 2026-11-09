import { briefSchema, type Brief, type Outcome, type RunEvent } from '@redline/agent-protocol';
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunFiles } from '../../ports/run';

/** The run's files on its volume (`RUN_LAYOUT`, `RUN_OUTPUTS`). */
export class VolumeRunFiles implements RunFiles {
  constructor(
    private readonly paths: {
      readonly brief: string;
      readonly events: string;
      readonly outcome: string;
    },
  ) {}

  async brief(): Promise<Brief> {
    const parsed = briefSchema.safeParse(JSON.parse(await readFile(this.paths.brief, 'utf8')));
    if (!parsed.success) throw new Error(`The brief is not valid: ${parsed.error.message}`);
    return parsed.data;
  }

  journal(event: RunEvent): Promise<void> {
    return appendFile(this.paths.events, `${JSON.stringify(event)}\n`);
  }

  /** Written next to its place and renamed: the receiver never sees half an outcome. */
  async conclude(outcome: Outcome): Promise<void> {
    const partial = path.join(
      path.dirname(this.paths.outcome),
      `.${path.basename(this.paths.outcome)}.partial`,
    );
    await writeFile(partial, JSON.stringify(outcome));
    await rename(partial, this.paths.outcome);
  }
}
