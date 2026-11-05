import path from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { build, type PluginOption } from 'vite';
import type { AppManifest, CorpusApp } from './corpus';

export const OUTPUT_DIR = path.resolve(import.meta.dirname, '../.output');

/** Both kinds of build users run: dev servers show source names, production minifies. */
export const BUILD_MODES = ['development', 'production'] as const;
export type BuildMode = (typeof BUILD_MODES)[number];

const FRAMEWORK_PLUGINS: Readonly<Record<AppManifest['framework'], () => PluginOption[]>> = {
  react: () => [react()],
  vue: () => [vue()],
  svelte: () => [svelte()],
  // Angular runs its JIT compiler in the page; TypeScript decorators are all it needs.
  angular: () => [],
};

export const outputOf = (app: CorpusApp, mode: BuildMode): string =>
  path.join(OUTPUT_DIR, app.name, mode);

/** Builds an app the way its framework's own tooling would, in the given mode. */
export const buildApp = async (app: CorpusApp, mode: BuildMode): Promise<string> => {
  const outDir = outputOf(app, mode);
  // Frameworks pick their development or production runtime from NODE_ENV.
  process.env['NODE_ENV'] = mode;
  await build({
    root: app.dir,
    configFile: false,
    logLevel: 'error',
    mode,
    base: './',
    plugins: [
      ...FRAMEWORK_PLUGINS[app.framework](),
      ...(app.styling === 'tailwind' ? [tailwindcss()] : []),
    ],
    build: {
      outDir,
      emptyOutDir: true,
      minify: mode === 'production',
      sourcemap: false,
    },
  });
  return outDir;
};

/** The harness script, injected into every page under evaluation. */
export const buildHarness = async (): Promise<string> => {
  const outDir = path.join(OUTPUT_DIR, 'harness');
  process.env['NODE_ENV'] = 'production';
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      lib: {
        entry: path.resolve(import.meta.dirname, 'harness/entry.ts'),
        formats: ['iife'],
        name: 'RedlineEvalHarness',
        fileName: () => 'harness.js',
      },
    },
  });
  return path.join(outDir, 'harness.js');
};
