import type { Instant, RunId, TaskId } from '../domain/ids';

export interface Clock {
  now(): Instant;
}

/** Ids nobody can guess: a task id is also its capability in the extension's hands. */
export interface IdGenerator {
  task(): TaskId;
  run(): RunId;
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}
