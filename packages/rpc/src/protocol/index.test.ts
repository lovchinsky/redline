import { describe, expect, it } from 'vitest';
import { captureMethods } from './capture';
import { diagnosticsMethods } from './diagnostics';
import { draftMethods } from './drafts';
import { protocol } from './index';
import { settingsMethods } from './settings';
import { systemMethods } from './system';
import { taskMethods } from './tasks';

describe('protocol', () => {
  it('takes every method from exactly one feature', () => {
    const features = {
      systemMethods,
      captureMethods,
      draftMethods,
      taskMethods,
      settingsMethods,
      diagnosticsMethods,
    };
    const owners = new Map<string, string[]>();
    for (const [feature, methods] of Object.entries(features)) {
      for (const method of Object.keys(methods)) {
        owners.set(method, [...(owners.get(method) ?? []), feature]);
      }
    }
    // Composed by spreading: a method two features define would silently lose one of them.
    expect([...owners].filter(([, by]) => by.length > 1)).toEqual([]);
    expect(Object.keys(protocol).sort()).toEqual([...owners.keys()].sort());
  });
});
