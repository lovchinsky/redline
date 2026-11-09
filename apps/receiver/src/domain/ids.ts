declare const brand: unique symbol;

/** A string that means one kind of thing: a task id is not a user id. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** The task's id, which the extension knows as `remoteId`. */
export type TaskId = Brand<string, 'TaskId'>;
export type RunId = Brand<string, 'RunId'>;
export type UserId = Brand<string, 'UserId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type QuestionId = Brand<string, 'QuestionId'>;
/** Lowercase hex SHA-256 of a stored file: the file's address in the blob store. */
export type BlobDigest = Brand<string, 'BlobDigest'>;

/** Milliseconds since the Unix epoch. */
export type Instant = number;

const DIGEST = /^[a-f0-9]{64}$/;

export const isBlobDigest = (value: string): value is BlobDigest => DIGEST.test(value);

/**
 * Ids arrive from storage, configuration and the network as plain strings. These name what a
 * string is once its source has been validated; they do not validate.
 */
export const TaskId = (value: string) => value as TaskId;
export const RunId = (value: string) => value as RunId;
export const UserId = (value: string) => value as UserId;
export const ProjectId = (value: string) => value as ProjectId;
export const QuestionId = (value: string) => value as QuestionId;
