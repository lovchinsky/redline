import type * as z from 'zod/mini';
import { appError, type AppError } from './errors';
import { err, ok, type Result } from './result';

/** Any zod/mini schema whose parsed output is T. */
export type Schema<T> = z.ZodMiniType<T>;

/** Parses untrusted data at a boundary; never throws. */
export const parseWith = <S extends z.ZodMiniType>(
  schema: S,
  input: unknown,
): Result<z.output<S>, AppError> => {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    appError('validation', 'Data does not match schema', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    }),
  );
};
