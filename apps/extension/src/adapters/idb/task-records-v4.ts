/**
 * Converts a version 3 task record to version 4: the delivery fields (project, bundle digest)
 * form one `delivery` record whose id is the receiver's idempotency key, status checks carry a
 * failure count, and a task the receiver answered 404 for is `lost`. Works on plain data,
 * frozen as it was: never on today's domain types.
 */

type StoredRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is StoredRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The failure reason a version 3 record holds for a task the receiver answered 404 for. */
const FORGOTTEN_REASON = 'The receiver no longer knows this task';

/**
 * The version 4 record of a version 3 task. `bundleDigest` is the digest of the task's stored
 * bundle, which a version 3 submitted record does not carry. Records that need no change come
 * back as is.
 */
export const upgradeTaskRecord = (record: unknown, bundleDigest: string | null): unknown => {
  if (!isRecord(record) || !isRecord(record['state'])) return record;
  const { kind, projectId, projectName, digest, ...rest } = record['state'];
  if (kind !== 'queued' && kind !== 'submitted' && kind !== 'failed') return record;

  const delivery = {
    // A version 3 delivery's idempotency key is the task id: kept, so a delivery whose
    // response was lost still finds the remote task it created.
    id: record['id'],
    projectId,
    projectName,
    digest: typeof digest === 'string' ? digest : (bundleDigest ?? ''),
  };
  if (kind !== 'submitted') return { ...record, state: { kind, delivery, ...rest } };

  const status = rest['status'];
  if (isRecord(status) && status['phase'] === 'failed' && status['reason'] === FORGOTTEN_REASON) {
    return {
      ...record,
      state: {
        kind: 'lost',
        delivery,
        remoteId: rest['remoteId'],
        submittedAt: rest['submittedAt'],
        lostAt: rest['checkedAt'],
      },
    };
  }
  return {
    ...record,
    state: { kind, delivery, ...rest, checkFailures: 0, checkError: null },
  };
};
