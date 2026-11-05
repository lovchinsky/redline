// Packs the production build the e2e tests ran on into the Chrome Web Store zip, without
// building again: what gets published is exactly what was tested.
// Usage: node scripts/pack-extension.mjs (after `pnpm build` or `pnpm test:e2e`)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const OUTPUT = path.resolve(import.meta.dirname, '../apps/extension/.output');
const BUILD = path.join(OUTPUT, 'chrome-mv3');
/** A fixed timestamp: the same build always packs into the same bytes. */
const MTIME = new Date('2026-01-01T00:00:00Z');

/** @param {string} dir @returns {Promise<string[]>} */
const filesIn = async (dir) =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(BUILD, path.join(entry.parentPath, entry.name)))
    .sort();

const { version } = JSON.parse(await readFile(path.join(BUILD, 'manifest.json'), 'utf8'));
/** @type {Record<string, [Uint8Array, { mtime: Date }]>} */
const entries = {};
for (const file of await filesIn(BUILD)) {
  entries[file.split(path.sep).join('/')] = [
    new Uint8Array(await readFile(path.join(BUILD, file))),
    { mtime: MTIME },
  ];
}
const zip = path.join(OUTPUT, `redline-${String(version)}-chrome.zip`);
await writeFile(zip, zipSync(entries, { level: 9 }));
console.log(`${path.relative(process.cwd(), zip)}: ${Object.keys(entries).length} files`);
