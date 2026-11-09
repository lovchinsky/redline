import { sql, type Kysely } from 'kysely';
import type { Budget, GrantTerms } from '../../domain/grant';
import type { TaskId } from '../../domain/ids';
import type { GrantBook, UsageEntry, UsageLedger } from '../../ports/gateway';
import { grantTermsFromRecord } from './records';
import type { Database } from './schema';
import { sha256 } from './store';

/**
 * What the gateway reads and writes in Postgres: the grants in force (read only) and the usage
 * it meters (append only). Nothing else of the receiver's state is the gateway's.
 */
export class PostgresGateway implements GrantBook, UsageLedger {
  constructor(private readonly db: Kysely<Database>) {}

  async terms(token: string): Promise<GrantTerms | null> {
    const row = await this.db
      .selectFrom('run_grants')
      .select(['run_id', 'terms'])
      .where('token_hash', '=', sha256(token))
      .executeTakeFirst();
    return row === undefined ? null : grantTermsFromRecord(row.terms, row.run_id);
  }

  async record(entry: UsageEntry): Promise<void> {
    await this.db
      .insertInto('run_usage')
      .values({
        run_id: entry.runId,
        task_id: entry.taskId,
        model: entry.model,
        input_tokens: entry.usage.input,
        output_tokens: entry.usage.output,
        cache_write_tokens: entry.usage.cacheWrite,
        cache_read_tokens: entry.usage.cacheRead,
        cost_usd: entry.costUsd,
        at: new Date(entry.at),
      })
      .execute();
  }

  async spent(taskId: TaskId): Promise<Budget> {
    const row = await this.db
      .selectFrom('run_usage')
      .select([
        sql<string>`coalesce(sum(cost_usd), 0)`.as('usd'),
        sql<string>`coalesce(sum(input_tokens + output_tokens + cache_write_tokens), 0)`.as(
          'tokens',
        ),
      ])
      .where('task_id', '=', taskId)
      .executeTakeFirstOrThrow();
    return { usd: Number(row.usd), tokens: Number(row.tokens) };
  }
}
