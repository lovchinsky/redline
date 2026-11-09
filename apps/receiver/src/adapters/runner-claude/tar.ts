import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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

/** An archive holding more than its reader takes: the fault of whoever wrote it. */
export class OversizedArchive extends Error {}

/**
 * The regular files of a tar archive whose names `take` accepts, at most `limits.file` bytes
 * each and `limits.total` together; a larger file or archive is an error, not a truncated one.
 * Anything but regular files (links, devices) is left out, and so is any name that is absolute
 * or climbs out of the archive (`..`). The archive is read to its end or its first error.
 */
export const filesOf = async (
  archive: Readable,
  take: (name: string) => boolean,
  limits: { readonly file: number; readonly total?: number },
): Promise<Map<string, Buffer>> => {
  const files = new Map<string, Buffer>();
  let taken = 0;
  const reader = extract();
  reader.on('entry', (header, stream, next) => {
    // An entry fails with its archive, whose failure the pipeline reports.
    stream.on('error', () => undefined);
    const name = header.name.replace(/^\.\//, '').replace(/\/$/, '');
    const size = header.size;
    const contained = !name.startsWith('/') && !name.split('/').includes('..');
    const wanted = header.type === 'file' && contained && take(name);
    if (wanted && size > limits.file) {
      next(new OversizedArchive(`${name} is larger than ${String(limits.file)} bytes`));
      return;
    }
    if (wanted && (taken += size) > (limits.total ?? Number.POSITIVE_INFINITY)) {
      next(new OversizedArchive(`The archive holds more than ${String(limits.total)} bytes`));
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
  await pipeline(archive, reader);
  return files;
};

/**
 * `archive` as it is, with every entry owned by `owner`: a sandbox owns the files it is given,
 * whoever made the archive.
 */
export const ownedBy = (archive: Readable, owner: { uid: number; gid: number }): Readable => {
  const reader = extract();
  const writer = pack();
  const owned = new PassThrough();
  reader.on('entry', (header, stream, next) => {
    stream.pipe(writer.entry({ ...header, ...owner, uname: '', gname: '' }, next));
  });
  reader.on('finish', () => {
    writer.finalize();
  });
  pipeline(archive, reader).catch((error: unknown) => {
    owned.destroy(error instanceof Error ? error : new Error(String(error)));
  });
  pipeline(writer, owned).catch(() => undefined);
  return owned;
};
