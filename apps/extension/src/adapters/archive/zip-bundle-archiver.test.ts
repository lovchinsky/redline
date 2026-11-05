import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipBundleArchiver } from './zip-bundle-archiver';

describe('ZipBundleArchiver', () => {
  it('packs the manifest and every file under its bundle path', async () => {
    const archive = await new ZipBundleArchiver().archive({
      manifest: { taskId: 't' } as never,
      files: new Map([
        ['context.md', new Blob(['# Redline task'], { type: 'text/markdown' })],
        [
          'assets/step-1/area-1-crop.png',
          new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
        ],
      ]),
    });
    if (!archive.ok) throw new Error(archive.error.message);
    const entries = unzipSync(new Uint8Array(await archive.value.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual([
      'assets/step-1/area-1-crop.png',
      'context.md',
      'manifest.json',
    ]);
    expect(new TextDecoder().decode(entries['context.md'])).toBe('# Redline task');
    expect(JSON.parse(new TextDecoder().decode(entries['manifest.json']))).toEqual({ taskId: 't' });
  });
});
