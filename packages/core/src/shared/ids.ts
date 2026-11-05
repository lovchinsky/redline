import * as z from 'zod/mini';

/**
 * Base schema for identifiers. Each entity brands it with its own name, e.g.
 *   export const TaskId = idSchema().brand<'TaskId'>();
 *   export type TaskId = z.infer<typeof TaskId>;
 * New ids are minted via `TaskId.parse(idGenerator.next())`.
 */
export const idSchema = () => z.string().check(z.minLength(1));
