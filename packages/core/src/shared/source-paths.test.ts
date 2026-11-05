import { describe, expect, it } from 'vitest';
import { projectRelative } from './source-paths';

describe('projectRelative', () => {
  it.each([
    ['/Users/maria/work/acme/src/components/Card.tsx', 'src/components/Card.tsx'],
    ['C:\\Users\\maria\\acme\\app\\page.tsx', 'app/page.tsx'],
    ['http://localhost:5173/src/App.vue?t=123', 'src/App.vue'],
    ['/var/www/build/assets/x.css', 'build/assets/x.css'],
  ])('%s → %s', (path, expected) => {
    expect(projectRelative(path)).toBe(expected);
  });
});
