import { mkdtemp, rm, stat } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskId } from '../../domain/ids';
import { ModelCredential } from '../../ports/access';
import { MemoryVault } from './memory-vault';
import { SocketVault, serveVault } from './socket-vault';

let dir: string;
let server: Server;
let held: MemoryVault;
let vault: SocketVault;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-vault-'));
  const socket = path.join(dir, 'vault.sock');
  held = new MemoryVault({ now: () => 0 }, 60_000);
  server = await serveVault(held, socket);
  vault = new SocketVault(socket);
});

afterEach(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the vault across its socket', () => {
  it('keeps a credential in the gateway’s memory, says what kind it is, and forgets it', async () => {
    const task = TaskId('task-1');
    expect(await vault.held(task)).toBeNull();
    await vault.deposit(task, new ModelCredential('subscription', 'sk-ant-oat01-x'));
    expect(await vault.held(task)).toBe('subscription');
    expect(held.credentialOf(task)?.reveal()).toBe('sk-ant-oat01-x');
    await vault.forget(task);
    expect(await vault.held(task)).toBeNull();
  });

  it('is open to the socket’s owner and group only', async () => {
    expect((await stat(path.join(dir, 'vault.sock'))).mode & 0o777).toBe(0o660);
  });
});
