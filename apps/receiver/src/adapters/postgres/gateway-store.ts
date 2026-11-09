import { sql, type Kysely } from 'kysely';
import type { Budget, GatewayRefusal, GrantTerms } from '../../domain/grant';
import type { RunId, TaskId } from '../../domain/ids';
import { randomUUID } from 'node:crypto';
import type { Instant } from '../../domain/ids';
import type { TokenUsage } from '../../domain/usage';
import type { GrantBook, MeteredRequest, UsageLedger } from '../../ports/gateway';
import { grantTermsFromRecord, refusalToRecord } from './records';
import type { Database } from './schema';
import { refusalOf, sha256 } from './shared';

/**
 * What the gateway reads and writes in Postgres: the grants in force (read only), its refusals
 * of runs, and the usage it meters (append only). Nothing else of the receiver's state is the
 * gateway's.
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

  refusalOf(runId: RunId): Promise<GatewayRefusal | null> {
    return refusalOf(this.db, runId);
  }

  async setRefusal(runId: RunId, refusal: GatewayRefusal | null): Promise<void> {
    if (refusal === null) {
      await this.db.deleteFrom('run_refusals').where('run_id', '=', runId).execute();
      return;
    }
    const record = JSON.stringify(refusalToRecord(refusal));
    const at = new Date();
    await this.db
      .insertInto('run_refusals')
      .values({ run_id: runId, refusal: record, at })
      .onConflict((conflict) => conflict.column('run_id').doUpdateSet({ refusal: record, at }))
      .execute();
  }

  /**
   * Under a lock of the task's own, for the transaction: two requests of a task are judged one
   * after the other, each with what the other holds.
   */
  async reserve(
    request: MeteredRequest,
    amount: Budget,
    admits: (spent: Budget) => boolean,
  ): Promise<string | null> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${request.taskId}, 0))`.execute(trx);
      if (!admits(await spentBy(trx, request.taskId))) return null;
      const reservation = randomUUID();
      await trx
        .insertInto('run_usage')
        .values({
          reservation,
          run_id: request.runId,
          task_id: request.taskId,
          model: request.model,
          input_tokens: 0,
          output_tokens: 0,
          cache_write_tokens: 0,
          cache_read_tokens: 0,
          cost_usd: amount.usd,
          counted_tokens: amount.tokens,
          settled: false,
          at: new Date(),
        })
        .execute();
      return reservation;
    });
  }

  async settle(
    reservation: string,
    usage: TokenUsage,
    spending: Budget,
    at: Instant,
  ): Promise<void> {
    await this.db
      .updateTable('run_usage')
      .set({
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_write_tokens: usage.cacheWrite,
        cache_read_tokens: usage.cacheRead,
        cost_usd: spending.usd,
        counted_tokens: spending.tokens,
        settled: true,
        at: new Date(at),
      })
      .where('reservation', '=', reservation)
      .where('settled', '=', false)
      .execute();
  }

  /** All a task has spent and holds, over every run. */
  spent(taskId: TaskId): Promise<Budget> {
    return spentBy(this.db, taskId);
  }
}

const spentBy = async (db: Kysely<Database>, taskId: TaskId): Promise<Budget> => {
  const row = await db
    .selectFrom('run_usage')
    .select([
      sql<string>`coalesce(sum(cost_usd), 0)`.as('usd'),
      sql<string>`coalesce(sum(counted_tokens), 0)`.as('tokens'),
    ])
    .where('task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  return { usd: Number(row.usd), tokens: Number(row.tokens) };
};
