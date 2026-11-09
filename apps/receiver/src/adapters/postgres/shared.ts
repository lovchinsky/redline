import { createHash } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type { GatewayRefusal } from '../../domain/grant';
import type { RunId } from '../../domain/ids';
import { refusalFromRecord } from './records';
import type { Database } from './schema';

/** What the stores of the receiver's tables have in common. */

export type Executor = Kysely<Database> | Transaction<Database>;

/** How a token is kept: by its hash, never as written. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The gateway's last refusal of a run (`run_refusals`), read by the gateway and the worker. */
export const refusalOf = async (db: Executor, runId: RunId): Promise<GatewayRefusal | null> => {
  const row = await db
    .selectFrom('run_refusals')
    .select('refusal')
    .where('run_id', '=', runId)
    .executeTakeFirst();
  return row === undefined ? null : refusalFromRecord(row.refusal, runId);
};
