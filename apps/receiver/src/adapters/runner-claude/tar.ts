import type { Readable } from 'node:stream';
import { extract, pack } from 'tar-stream';

export interface TarFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** Modes of an archive's entries; read-only unless said otherwise. */
export interface TarModes {
  readonly file: number;
  readonly directory: number;
}

const READ_ONLY: TarModes = { file: 0o444, directory: 0o555 };

/** A tar archive of `files` and their directories, owned by `owner` (`uid:gid`). */
export const tarOf = async (
  files: readonly TarFile[],
  owner: { uid: number; gid: number },
  modes: Partial<TarModes> = {},
): Promise<Buffer> => {
  const { file: fileMode, directory: directoryMode } = { ...READ_ONLY, ...modes };
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
      archive.entry({ name: `${directory}/`, type: 'directory', mode: directoryMode, ...owner });
    }
    archive.entry(
      { name: file.path, mode: fileMode, size: file.content.byteLength, ...owner },
      Buffer.from(file.content),
    );
  }
  archive.finalize();
  await done;
  return Buffer.concat(chunks);
};

/**
 * The regular files of a tar archive whose names `take` accepts, at most `limits.file` bytes
 * each and `limits.total` together; a larger file or archive is an error, not a truncated one.
 * Anything but regular files (links, devices) is left out.
 */
export const filesOf = async (
  archive: Readable,
  take: (name: string) => boolean,
  limits: { readonly file: number; readonly total?: number },
): Promise<Map<string, Buffer>> => {
  const files = new Map<string, Buffer>();
  let taken = 0;
  const reader = extract();
  const done = new Promise<void>((resolve, reject) => {
    reader.on('finish', resolve);
    reader.on('error', reject);
  });
  reader.on('entry', (header, stream, next) => {
    const name = header.name.replace(/^\.\//, '').replace(/\/$/, '');
    const size = header.size;
    const wanted = header.type === 'file' && take(name);
    if (wanted && size > limits.file) {
      reader.destroy(new Error(`${name} is larger than ${String(limits.file)} bytes`));
      return;
    }
    if (wanted && (taken += size) > (limits.total ?? Number.POSITIVE_INFINITY)) {
      reader.destroy(new Error(`The archive holds more than ${String(limits.total)} bytes`));
      return;
    }
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: unknown) => {
      if (wanted && Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    stream.on('end', () => {
      if (wanted) files.set(name, Buffer.concat(chunks));
      next();
    });
    stream.resume();
  });
  archive.pipe(reader);
  await done;
  return files;
};
