// Bundles agent-host for production: agent-host itself and the server of its ask_requester tool,
// each with the workspace packages it uses (shipped as TypeScript) in one ES module; third-party
// packages stay external and are installed beside them.
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const external = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith('@redline/'),
);

await build({
  entryPoints: {
    'agent-host': path.join(root, 'src/entrypoints/main.ts'),
    'ask-tool': path.join(root, 'src/entrypoints/ask-tool.ts'),
  },
  outdir: path.join(root, 'dist'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'warning',
});
