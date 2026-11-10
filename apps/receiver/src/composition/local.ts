import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReceiverConfig } from '../adapters/config/config';
import { openDatabase } from '../adapters/postgres/database';
import { PostgresUsers } from '../adapters/postgres/users';
import { UserId } from '../domain/ids';
import type { Logger } from '../ports/system';
import { migrateStorage } from './receiver';
import type { Settings } from './settings';

/** The one user of a receiver on one person's machine. */
export const LOCAL_USER = UserId('me');

/**
 * Gets a receiver on one person's machine ready: storage up to date, its one user, and a token
 * for the extension. The token is kept in `localPath` (on that machine only, beside an API that
 * listens on it alone), so that every start shows the same one; a kept token that no longer
 * opens the receiver (its database was made anew) is replaced.
 */
export const initLocal = async (
  settings: Settings,
  config: ReceiverConfig,
  logger: Logger,
): Promise<string> => {
  await migrateStorage(settings, config, logger);
  const db = openDatabase(settings.databaseUrl, 1);
  try {
    const users = new PostgresUsers(db);
    await users.add({ id: LOCAL_USER, name: 'Me', email: null }, new Date());
    const file = path.join(settings.localPath, 'token');
    const kept = await readFile(file, 'utf8').then(
      (text) => text.trim(),
      () => null,
    );
    if (kept !== null && kept !== '' && (await users.authenticate(kept)) !== null) return kept;
    const token = await users.issueToken(LOCAL_USER, 'local', new Date());
    if (token === null) throw new Error('The local user was not stored');
    await mkdir(settings.localPath, { recursive: true });
    await writeFile(file, `${token}\n`, { mode: 0o600 });
    return token;
  } finally {
    await db.destroy();
  }
};
