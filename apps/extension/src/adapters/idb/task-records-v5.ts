/**
 * Converts version 4 task records for version 5: a draft (state `draft`) goes to the `drafts`
 * store without a `state`; a sent task stays in `tasks`. Works on plain data, frozen as it was.
 */

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The draft a version 4 task record holds, or `null` when it was sent (it stays a task). */
export const draftOf = (record: unknown): Readonly<Record<string, unknown>> | null => {
  if (!isRecord(record) || !isRecord(record['state']) || record['state']['kind'] !== 'draft') {
    return null;
  }
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'state'));
};
