import type { Kysely } from 'kysely';
import type { HostedRepository, RepositoryRegistry } from '../../ports/source';
import type { Database } from './schema';

/** The repositories the worker last found on the git host, in Postgres. */
export class PostgresRepositories implements RepositoryRegistry {
  constructor(private readonly db: Kysely<Database>) {}

  async replace(repositories: readonly HostedRepository[]): Promise<void> {
    const at = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('repositories').execute();
      if (repositories.length === 0) return;
      await trx
        .insertInto('repositories')
        .values(
          repositories.map((repository) => ({
            name: repository.name,
            base_branch: repository.baseBranch,
            found_at: at,
          })),
        )
        .execute();
    });
  }

  async list(): Promise<readonly HostedRepository[]> {
    const rows = await this.db
      .selectFrom('repositories')
      .select(['name', 'base_branch'])
      .orderBy('name')
      .execute();
    return rows.map((row) => ({ name: row.name, baseBranch: row.base_branch }));
  }
}
