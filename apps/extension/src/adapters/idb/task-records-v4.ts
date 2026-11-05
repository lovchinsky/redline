/**
 * Version 4 of the task records: the fields of a delivery (project, bundle digest) move into one
 * `delivery` record with its own id, which the receiver uses as the idempotency key; a status
 * check that fails is counted; a task the receiver forgot is `lost` instead of a made-up
 * `failed` status. Works on plain data, frozen as it was: never on today's domain types.
 */

type StoredRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is StoredRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The status version 3 wrote when the receiver answered 404 for a task. */
const FORGOTTEN_REASON = 'The receiver no longer knows this task';

/**
 * The record a version 3 task becomes. `bundleDigest` is the digest of the task's stored bundle,
 * which version 3 did not keep on submitted tasks. Records that need no change come back as is.
 */
export const upgradeTaskRecord = (record: unknown, bundleDigest: string | null): unknown => {
  if (!isRecord(record) || !isRecord(record['state'])) return record;
  const { kind, projectId, projectName, digest, ...rest } = record['state'];
  if (kind !== 'queued' && kind !== 'submitted' && kind !== 'failed') return record;

  const delivery = {
    // Version 3 sent the task id as the idempotency key: keep it, so a delivery whose
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
