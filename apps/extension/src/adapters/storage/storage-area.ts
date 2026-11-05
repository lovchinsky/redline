import { appError, err, ok, parseWith, type AppError, type Result } from '@redline/core';
import type * as z from 'zod/mini';

/** The part of `chrome.storage.StorageArea` the stores use; an in-memory fake in tests. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const storageError = (cause: unknown, operation: string): AppError =>
  appError('storage', `${operation} failed`, {
    message: cause instanceof Error ? cause.message : String(cause),
  });

/** One typed value under one key, validated on every read. */
export class StoredValue<S extends z.ZodMiniType> {
  constructor(
    private readonly area: StorageArea,
    private readonly key: string,
    private readonly schema: S,
  ) {}

  async read(): Promise<Result<z.output<S> | null, AppError>> {
    try {
      const raw = (await this.area.get(this.key))[this.key];
      if (raw === undefined) return ok(null);
      const parsed = parseWith(this.schema, raw);
      return parsed.ok
        ? parsed
        : err(
            appError('storage', `Stored "${this.key}" is corrupted`, { ...parsed.error.details }),
          );
    } catch (cause) {
      return err(storageError(cause, `Reading "${this.key}"`));
    }
  }

  async write(value: z.output<S> | null): Promise<Result<void, AppError>> {
    try {
      if (value === null) await this.area.remove(this.key);
      else await this.area.set({ [this.key]: value });
      return ok(undefined);
    } catch (cause) {
      return err(storageError(cause, `Saving "${this.key}"`));
    }
  }
}

/** In-memory `StorageArea`, structured-cloned like the real one. */
export const memoryStorageArea = (): StorageArea => {
  const items = new Map<string, unknown>();
  return {
    get: (key) => Promise.resolve(items.has(key) ? { [key]: structuredClone(items.get(key)) } : {}),
    set: (values) => {
      for (const [key, value] of Object.entries(values)) items.set(key, structuredClone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      items.delete(key);
      return Promise.resolve();
    },
  };
};
