import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import * as z from 'zod/mini';

export const CORPUS_DIR = path.resolve(import.meta.dirname, '../corpus');

const caseSchema = z.object({
  id: z.string(),
  /** Playwright selector of the element a person circles; the first match is used. */
  circle: z.string(),
  /** Files where the change belongs: the component, and where its content is written. */
  expect: z.array(z.string()).check(z.minLength(1)),
});

const appSchema = z.object({
  framework: z.enum(['react', 'vue', 'svelte', 'angular']),
  styling: z.enum(['tailwind', 'css-modules', 'styled-components', 'scoped-css', 'plain-css']),
  i18n: z.boolean(),
  cases: z.array(caseSchema).check(z.minLength(1)),
});

export type EvalCase = z.infer<typeof caseSchema>;
export type AppManifest = z.infer<typeof appSchema>;

export interface CorpusApp extends AppManifest {
  readonly name: string;
  readonly dir: string;
  /** Every source file, by path relative to the app: what an agent would grep. */
  readonly sources: ReadonlyMap<string, string>;
}

/** Files of the app's own code: everything but build output and the case list. */
const SOURCE_FILE = /\.(tsx?|jsx?|vue|svelte|html|css|json)$/;
const IGNORED = new Set(['app.json', 'node_modules', 'dist']);

const readSources = async (dir: string): Promise<Map<string, string>> => {
  const sources = new Map<string, string>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(entry.parentPath, entry.name);
    const relative = path.relative(dir, full).split(path.sep).join('/');
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;
    if (relative.split('/').some((part) => IGNORED.has(part))) continue;
    sources.set(relative, await readFile(full, 'utf8'));
  }
  return sources;
};

export const loadCorpus = async (only?: string): Promise<CorpusApp[]> => {
  const names = (await readdir(CORPUS_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && (only === undefined || entry.name === only))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const dir = path.join(CORPUS_DIR, name);
      const manifest = appSchema.parse(
        JSON.parse(await readFile(path.join(dir, 'app.json'), 'utf8')),
      );
      const sources = await readSources(dir);
      for (const { id, expect } of manifest.cases) {
        for (const file of expect) {
          if (!sources.has(file)) throw new Error(`${name}/${id}: no source file ${file}`);
        }
      }
      return { ...manifest, name, dir, sources };
    }),
  );
};
