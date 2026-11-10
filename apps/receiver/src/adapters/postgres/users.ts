import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import { UserId } from '../../domain/ids';
import type { Identity, User } from '../../ports/access';
import type { Database } from './schema';
import { sha256 } from './shared';

const userOf = (row: { id: string; name: string; email: string | null }): User => ({
  id: UserId(row.id),
  name: row.name,
  email: row.email,
});

/** Users and their access tokens. A token is shown once, when issued; only its hash is kept. */
export class PostgresUsers implements Identity {
  constructor(private readonly db: Kysely<Database>) {}

  async authenticate(token: string): Promise<User | null> {
    const row = await this.db
      .selectFrom('tokens')
      .innerJoin('users', 'users.id', 'tokens.user_id')
      .select(['users.id', 'users.name', 'users.email'])
      .where('tokens.token_hash', '=', sha256(token))
      .where('tokens.revoked_at', 'is', null)
      .executeTakeFirst();
    return row === undefined ? null : userOf(row);
  }

  async get(id: UserId): Promise<User | null> {
    const row = await this.db
      .selectFrom('users')
      .select(['id', 'name', 'email'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row === undefined ? null : userOf(row);
  }

  async list(): Promise<readonly (User & { readonly tokens: number })[]> {
    const rows = await this.db
      .selectFrom('users')
      .leftJoin('tokens', (join) =>
        join.onRef('tokens.user_id', '=', 'users.id').on('tokens.revoked_at', 'is', null),
      )
      .select(({ fn }) => [
        'users.id',
        'users.name',
        'users.email',
        fn.count<string>('tokens.token_hash').as('tokens'),
      ])
      .groupBy(['users.id', 'users.name', 'users.email'])
      .orderBy('users.id')
      .execute();
    return rows.map((row) => ({ ...userOf(row), tokens: Number(row.tokens) }));
  }

  async add(user: User, now: Date): Promise<'added' | 'exists'> {
    const added = await this.db
      .insertInto('users')
      .values({ id: user.id, name: user.name, email: user.email, created_at: now })
      .onConflict((conflict) => conflict.column('id').doNothing())
      .returning('id')
      .executeTakeFirst();
    return added === undefined ? 'exists' : 'added';
  }

  /** Adds the user, or gives the one with its id this name and email. */
  async save(user: User, now: Date): Promise<void> {
    await this.db
      .insertInto('users')
      .values({ id: user.id, name: user.name, email: user.email, created_at: now })
      .onConflict((conflict) =>
        conflict.column('id').doUpdateSet({ name: user.name, email: user.email }),
      )
      .execute();
  }

  /** Issues a new token for a user and returns it: the only time it can be read. */
  async issueToken(id: UserId, label: string, now: Date): Promise<string | null> {
    if ((await this.get(id)) === null) return null;
    const token = `rl_${randomBytes(32).toString('base64url')}`;
    await this.db
      .insertInto('tokens')
      .values({ token_hash: sha256(token), user_id: id, label, created_at: now, revoked_at: null })
      .execute();
    return token;
  }

  /** Revokes every token of a user; returns how many were active. */
  async revokeTokens(id: UserId, now: Date): Promise<number> {
    const revoked = await this.db
      .updateTable('tokens')
      .set({ revoked_at: now })
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(revoked.numUpdatedRows);
  }
}
