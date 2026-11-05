import { bindingSchema, ok, type AppError, type Binding, type Result } from '@redline/core';
import * as z from 'zod/mini';
import type { BindingStore } from '../../ports/delivery';
import { StoredValue, type StorageArea } from './storage-area';

const bindingsSchema = z.readonly(z.array(bindingSchema));

/** Site → project bindings in `storage.local`, one list under one key. */
export class StorageBindingStore implements BindingStore {
  private readonly value: StoredValue<typeof bindingsSchema>;

  constructor(area: StorageArea) {
    this.value = new StoredValue(area, 'bindings', bindingsSchema);
  }

  async all(): Promise<Result<readonly Binding[], AppError>> {
    const bindings = await this.value.read();
    return bindings.ok ? ok(bindings.value ?? []) : bindings;
  }

  async put(binding: Binding): Promise<Result<void, AppError>> {
    const bindings = await this.all();
    if (!bindings.ok) return bindings;
    return this.value.write([
      ...bindings.value.filter((existing) => existing.pattern !== binding.pattern),
      binding,
    ]);
  }

  async remove(pattern: string): Promise<Result<void, AppError>> {
    const bindings = await this.all();
    if (!bindings.ok) return bindings;
    return this.value.write(bindings.value.filter((binding) => binding.pattern !== pattern));
  }
}
