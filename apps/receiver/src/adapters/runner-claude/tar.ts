import type { Readable } from 'node:stream';
import { extract, pack } from 'tar-stream';

export interface TarFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** A tar archive of `files`, owned by `owner` (`uid:gid`) and readable only, with `mode`. */
export const tarOf = async (
  files: readonly TarFile[],
  owner: { uid: number; gid: number },
  mode = 0o444,
): Promise<Buffer> => {
  const archive = pack();
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: unknown) => {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk);
  });
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i += 1) {
      const directory = parts.slice(0, i).join('/');
      if (directories.has(directory)) continue;
      directories.add(directory);
      archive.entry({ name: `${directory}/`, type: 'directory', mode: 0o555, ...owner });
    }
    archive.entry(
      { name: file.path, mode, size: file.content.byteLength, ...owner },
      Buffer.from(file.content),
    );
  }
  archive.finalize();
  await done;
  return Buffer.concat(chunks);
};

/**
 * The regular files of a tar archive whose names are in `wanted`, at most `limit` bytes each;
 * a larger file is an error, not a truncated one.
 */
export const filesOf = async (
  archive: Readable,
  wanted: ReadonlySet<string>,
  limit: number,
): Promise<Map<string, Buffer>> => {
  const files = new Map<string, Buffer>();
  const reader = extract();
  const done = new Promise<void>((resolve, reject) => {
    reader.on('finish', resolve);
    reader.on('error', reject);
  });
  reader.on('entry', (header, stream, next) => {
    const name = header.name.replace(/^\.\//, '').replace(/\/$/, '');
    const take = header.type === 'file' && wanted.has(name);
    if (take && header.size > limit) {
      reader.destroy(new Error(`${name} is larger than ${String(limit)} bytes`));
      return;
    }
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: unknown) => {
      if (take && Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    stream.on('end', () => {
      if (take) files.set(name, Buffer.concat(chunks));
      next();
    });
    stream.resume();
  });
  archive.pipe(reader);
  await done;
  return files;
};
