import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const STAND_IN_IMAGE = 'redline-test/stand-in-agent:1';
export const SANDBOX_USER = { uid: 1000, gid: 1000 };

/** The binaries a sandbox of the test image has, and the libraries they load. */
const BINARIES = ['/bin/sh', process.execPath];

const librariesOf = async (binary: string): Promise<string[]> => {
  const { stdout } = await run('ldd', [binary]);
  return [...stdout.matchAll(/(\/\S+\.so[^\s]*)/g)].map((match) => match[1] ?? '').filter(Boolean);
};

/**
 * An image made from this machine's own `sh` and `node`, with the stand-in agent as its
 * entrypoint and the run's directories owned by the sandbox user, as `redline-agent` has them.
 * Built with `docker import`: nothing is pulled.
 */
export const buildStandInImage = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'redline-image-'));
  try {
    const files = new Set<string>();
    for (const binary of BINARIES) {
      files.add(binary);
      for (const library of await librariesOf(binary)) files.add(library);
    }
    for (const file of files) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(await realpath(file), target);
      await chmod(target, 0o755);
    }
    await mkdir(path.join(root, 'usr/bin'), { recursive: true });
    await copyFile(process.execPath, path.join(root, 'usr/bin/node'));
    await mkdir(path.join(root, 'opt'), { recursive: true });
    await writeFile(
      path.join(root, 'opt/stand-in-agent.mjs'),
      await readFile(path.join(import.meta.dirname, 'stand-in-agent.mjs')),
    );
    for (const directory of [
      'workspace',
      'redline/input',
      'redline/out',
      'redline/session',
      'tmp',
      'etc',
    ]) {
      await mkdir(path.join(root, directory), { recursive: true });
    }
    const owner = `--owner=${String(SANDBOX_USER.uid)}`;
    const group = `--group=${String(SANDBOX_USER.gid)}`;
    const archive = path.join(root, '..', `${path.basename(root)}.tar`);
    await run('tar', [
      '-C',
      root,
      '-cf',
      archive,
      '--numeric-owner',
      '--exclude=./workspace',
      '--exclude=./redline',
      '.',
    ]);
    await run('tar', [
      '-C',
      root,
      '-rf',
      archive,
      '--numeric-owner',
      owner,
      group,
      './workspace',
      './redline',
    ]);
    await run('docker', [
      'import',
      '--change',
      'ENTRYPOINT ["/usr/bin/node", "/opt/stand-in-agent.mjs"]',
      archive,
      STAND_IN_IMAGE,
    ]);
    await rm(archive, { force: true });
    return STAND_IN_IMAGE;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const realpath = async (file: string) => (await import('node:fs/promises')).realpath(file);

/** An internal network, as a deployment's compose file makes the sandbox networks. */
export const internalNetwork = async (name: string): Promise<void> => {
  await run('docker', ['network', 'rm', name]).catch(() => undefined);
  await run('docker', ['network', 'create', '--internal', name]);
};

export const removeNetwork = async (name: string): Promise<void> => {
  await run('docker', ['network', 'rm', name]).catch(() => undefined);
};
