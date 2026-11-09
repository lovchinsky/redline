import { pauseSchema, type Pause } from '@redline/agent-protocol';
import { Readable } from 'node:stream';
import { filesOf, tarOf, type TarFile } from './tar';

/** The most a paused session's files, its work included, may take. */
export const SNAPSHOT_LIMIT = 256 * 1024 * 1024;

const PAUSE = 'pause.json';
const WORK = 'work.bundle';
/** The directory of a snapshot the session's files are under. */
const SESSION_DIRECTORY = 'session';

/**
 * A paused session, as one run leaves it and the run that goes on with it is given it: where
 * the session stands (agent-host's `pause`), the work so far, and Claude Code's files of it.
 */
export interface PausedSession {
  readonly pause: Pause;
  /** The work bundle (`RUN_OUTPUTS.work`), or null when the work left the base unchanged. */
  readonly work: Uint8Array | null;
  /** The session directory's files, by their paths in it. */
  readonly session: readonly TarFile[];
}

const ROOT = { uid: 0, gid: 0 };

/** The snapshot's bytes: a tar archive of the pause, the work and the session's files. */
export const packSnapshot = (paused: PausedSession): Promise<Buffer> =>
  tarOf(
    [
      { path: PAUSE, content: new TextEncoder().encode(JSON.stringify(paused.pause)) },
      ...(paused.work === null ? [] : [{ path: WORK, content: paused.work }]),
      ...paused.session.map((file) => ({
        path: `${SESSION_DIRECTORY}/${file.path}`,
        content: file.content,
      })),
    ],
    ROOT,
  );

/** A snapshot as `packSnapshot` stored it; an archive that is not one is an error. */
export const unpackSnapshot = async (bytes: Uint8Array): Promise<PausedSession> => {
  const files = await filesOf(Readable.from([Buffer.from(bytes)]), () => true, {
    file: SNAPSHOT_LIMIT,
    total: SNAPSHOT_LIMIT,
  });
  const pause = files.get(PAUSE);
  if (pause === undefined) throw new Error('The snapshot has no pause');
  const prefix = `${SESSION_DIRECTORY}/`;
  return {
    pause: pauseSchema.parse(JSON.parse(pause.toString('utf8'))),
    work: files.get(WORK) ?? null,
    session: [...files]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, content]) => ({ path: name.slice(prefix.length), content })),
  };
};

/**
 * Claude Code's transcripts of the session, from an archive of the session directory:
 * `projects/**.jsonl`, all a resume needs. The agent could have put anything there; its
 * settings, hooks or any other file stay behind.
 */
export const sessionFilesOf = async (archive: Readable): Promise<TarFile[]> => {
  const transcript = (name: string) => name.startsWith('projects/') && name.endsWith('.jsonl');
  const files = await filesOf(archive, transcript, {
    file: SNAPSHOT_LIMIT,
    total: SNAPSHOT_LIMIT,
  });
  return [...files].map(([name, content]) => ({ path: name, content }));
};
