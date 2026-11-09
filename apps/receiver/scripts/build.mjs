// Bundles the receiver for production: its code and the workspace packages it uses (shipped as
// TypeScript) into one ES module; third-party packages stay external and are installed beside it.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const external = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith('@redline/'),
);

await build({
  entryPoints: [path.join(root, 'src/entrypoints/main.ts')],
  outfile: path.join(root, 'dist/receiver.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'warning',
});
