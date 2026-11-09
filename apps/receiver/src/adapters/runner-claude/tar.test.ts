import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { extract } from 'tar-stream';
import { OversizedArchive, filesOf, ownedBy, tarOf } from './tar';

const owner = { uid: 1000, gid: 1000 };
const text = (value: string) => new TextEncoder().encode(value);
const all = () => true;

describe('filesOf', () => {
  it('leaves out names that are absolute or climb out of the archive', async () => {
    const archive = await tarOf(
      [
        { path: 'out/outcome.json', content: text('{}') },
        { path: 'out/../../workspace/evil.jsonl', content: text('x') },
        { path: '/etc/passwd', content: text('x') },
      ],
      owner,
    );
    const files = await filesOf(Readable.from([archive]), all, { file: 1024 });
    expect([...files.keys()]).toEqual(['out/outcome.json']);
  });

  it('refuses an archive larger than its reader takes, file by file and in all', async () => {
    const archive = await tarOf(
      [
        { path: 'a', content: text('x'.repeat(600)) },
        { path: 'b', content: text('x'.repeat(600)) },
      ],
      owner,
    );
    await expect(filesOf(Readable.from([archive]), all, { file: 500 })).rejects.toBeInstanceOf(
      OversizedArchive,
    );
    await expect(
      filesOf(Readable.from([archive]), all, { file: 1000, total: 1000 }),
    ).rejects.toBeInstanceOf(OversizedArchive);
  });

  it('fails, rather than waits, on an archive cut off on the way', async () => {
    const archive = await tarOf([{ path: 'a', content: text('x'.repeat(4096)) }], owner);
    const cut = new Readable({
      read() {
        this.push(archive.subarray(0, 1024));
        this.destroy(new Error('socket hang up'));
      },
    });
    await expect(filesOf(cut, all, { file: 1 << 20 })).rejects.toThrow(/hang up/);
  });
});

describe('ownedBy', () => {
  it('gives every entry to the owner, contents unchanged', async () => {
    const archive = await tarOf([{ path: 'src/Card.css', content: text('.card { }') }], {
      uid: 0,
      gid: 0,
    });
    const owners: string[] = [];
    const reader = extract();
    reader.on('entry', (header, stream, next) => {
      owners.push(`${header.name} ${String(header.uid)}:${String(header.gid)}`);
      stream.on('end', next);
      stream.resume();
    });
    const owned = ownedBy(Readable.from([archive]), owner);
    const chunks: Buffer[] = [];
    for await (const chunk of owned) chunks.push(chunk as Buffer);
    const rewritten = Buffer.concat(chunks);
    await new Promise<void>((resolve) => {
      reader.on('finish', resolve);
      reader.end(rewritten);
    });
    expect(owners).toEqual(['src/ 1000:1000', 'src/Card.css 1000:1000']);
    const files = await filesOf(Readable.from([rewritten]), all, { file: 1024 });
    expect(files.get('src/Card.css')?.toString()).toBe('.card { }');
  });
});
