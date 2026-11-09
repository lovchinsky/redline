import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sampleBrief } from '../../application/testing/brief';
import { VolumeRunFiles } from './run-files';

let dir: string;
let files: VolumeRunFiles;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-host-files-'));
  files = new VolumeRunFiles({
    brief: path.join(dir, 'brief.json'),
    events: path.join(dir, 'events.jsonl'),
    outcome: path.join(dir, 'outcome.json'),
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('VolumeRunFiles', () => {
  it('reads a valid brief and refuses another', async () => {
    await writeFile(path.join(dir, 'brief.json'), JSON.stringify(sampleBrief()));
    expect(await files.brief()).toEqual(sampleBrief());
    await writeFile(
      path.join(dir, 'brief.json'),
      JSON.stringify({ ...sampleBrief(), protocol: 9 }),
    );
    await expect(files.brief()).rejects.toThrow('The brief is not valid');
  });

  it('appends events as lines and writes the outcome whole', async () => {
    const at = '2026-11-09T12:00:00.000Z';
    await files.journal({ kind: 'started', at, model: 'm', resumed: false });
    await files.journal({ kind: 'ended', at, result: 'no-change' });
    expect(
      (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2);
    const outcome = {
      protocol: 1 as const,
      runId: 'run-1',
      result: { kind: 'no-change' as const, explanation: 'Fine' },
      pause: null,
      usage: { turns: 1, durationMs: 1, costUsd: 0 },
    };
    await files.conclude(outcome);
    expect(JSON.parse(await readFile(path.join(dir, 'outcome.json'), 'utf8'))).toEqual(outcome);
    expect((await readdir(dir)).filter((name) => name.includes('partial'))).toEqual([]);
  });
});
