import { ProjectId, type Result } from '@redline/core';
import { describe, expect, it } from 'vitest';
import { memoryStorageArea } from './storage-area';
import { StorageBindingStore } from './storage-bindings';
import { StorageSettingsStore } from './storage-settings';

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const binding = (pattern: string, project: string) => ({
  pattern,
  projectId: ProjectId.parse(project),
  projectName: project,
  createdAt: 1,
});

describe('StorageBindingStore', () => {
  it('adds, replaces by pattern and removes bindings', async () => {
    const store = new StorageBindingStore(memoryStorageArea());
    expect(value(await store.all())).toEqual([]);
    value(await store.put(binding('https://a.io', 'one')));
    value(await store.put(binding('https://b.io', 'two')));
    value(await store.put(binding('https://a.io', 'three')));
    expect(value(await store.all()).map((b) => [b.pattern, b.projectId])).toEqual([
      ['https://b.io', 'two'],
      ['https://a.io', 'three'],
    ]);
    value(await store.remove('https://b.io'));
    expect(value(await store.all())).toHaveLength(1);
  });
});

describe('StorageSettingsStore', () => {
  it('stores the receiver and reports corrupted data instead of trusting it', async () => {
    const area = memoryStorageArea();
    const store = new StorageSettingsStore(area);
    expect(value(await store.receiver())).toBeNull();
    value(await store.setReceiver({ baseUrl: 'https://r.acme.io', token: null }));
    expect(value(await store.receiver())).toEqual({ baseUrl: 'https://r.acme.io', token: null });

    await area.set({ receiver: { baseUrl: 42 } });
    expect(await store.receiver()).toMatchObject({ ok: false, error: { code: 'storage' } });
  });
});
