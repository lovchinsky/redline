import { describe, expect, it } from 'vitest';
import { BundlePaths } from './paths';

describe('BundlePaths', () => {
  const owner = { stepId: 'step-a', shapeId: 's1' };
  const file = (content: string) => ({
    name: 'dom',
    extension: 'html' as const,
    mediaType: 'text/html',
    content,
  });

  it('gives a file asked for twice one path, and another file of the same name its own', () => {
    const paths = new BundlePaths();
    const scope = paths.scope(1, 2, owner);
    const first = scope.detail(file('<main>a</main>'));
    expect(scope.detail(file('<main>a</main>'))).toBe(first);
    const second = scope.detail(file('<main>b</main>'));
    expect(second).not.toBe(first);
    expect(
      paths
        .all()
        .map((rendered) => (rendered.content.kind === 'text' ? rendered.content.text : '')),
    ).toEqual(['<main>a</main>', '<main>b</main>']);
  });
});
