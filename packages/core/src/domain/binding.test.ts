import { describe, expect, it } from 'vitest';
import {
  ProjectId,
  formatBindingPattern,
  hostPermissionOf,
  originPatternOf,
  parseBindingPattern,
  resolveBinding,
  type Binding,
} from './binding';

const binding = (pattern: string, project: string): Binding => ({
  pattern,
  projectId: ProjectId.parse(project),
  projectName: project,
  createdAt: 0,
});

const canonical = (text: string) => {
  const parsed = parseBindingPattern(text);
  return parsed.ok ? formatBindingPattern(parsed.value) : parsed.error.code;
};

describe('binding patterns', () => {
  it.each([
    ['https://Staging.Acme.io', 'https://staging.acme.io'],
    ['https://staging.acme.io/', 'https://staging.acme.io'],
    ['https://staging.acme.io:443', 'https://staging.acme.io'],
    ['http://localhost:3000/admin/', 'http://localhost:3000/admin'],
    ['https://*.acme.io', 'https://*.acme.io'],
    ['ftp://acme.io', 'validation'],
    ['https://*.localhost', 'validation'],
    ['https://acme.io?x=1', 'validation'],
    ['acme.io', 'validation'],
  ])('%s → %s', (text, expected) => {
    expect(canonical(text)).toBe(expected);
  });

  it('derives the host permission a pattern needs', () => {
    const permission = (text: string) => {
      const parsed = parseBindingPattern(text);
      return parsed.ok ? hostPermissionOf(parsed.value) : null;
    };
    expect(permission('http://localhost:3000/admin')).toBe('http://localhost/*');
    expect(permission('https://*.acme.io')).toBe('https://*.acme.io/*');
  });

  it('derives the exact origin pattern of a page', () => {
    expect(originPatternOf(new URL('http://localhost:5173/pricing?x=1'))).toBe(
      'http://localhost:5173',
    );
  });
});

describe('resolveBinding', () => {
  const bindings = [
    binding('https://*.acme.io', 'any-acme'),
    binding('https://app.acme.io', 'app'),
    binding('https://app.acme.io/admin', 'admin'),
    binding('http://localhost:3000', 'local'),
  ];
  const resolve = (url: string) => resolveBinding(bindings, new URL(url))?.projectId ?? null;

  it('prefers an exact host over a wildcard and a longer path over a shorter one', () => {
    expect(resolve('https://app.acme.io/pricing')).toBe('app');
    expect(resolve('https://app.acme.io/admin/users')).toBe('admin');
    expect(resolve('https://app.acme.io/administrator')).toBe('app');
    expect(resolve('https://docs.acme.io/')).toBe('any-acme');
  });

  it('requires the same scheme and port, and never matches the apex with a wildcard', () => {
    expect(resolve('http://app.acme.io/')).toBeNull();
    expect(resolve('http://localhost:3001/')).toBeNull();
    expect(resolve('http://localhost:3000/x')).toBe('local');
    expect(resolve('https://acme.io/')).toBeNull();
  });
});
