import { describe, expect, it } from 'vitest';
import { DEFAULT_CHANGE_POLICY } from '../../domain/change-policy';
import { ProjectId } from '../../domain/ids';
import { ConfiguredProjects, parseConfig } from './config';

const minimal = `
models:
  credentials: required
projects:
  - id: acme-web
    name: Acme Web
    repository: { host: github, name: acme/web }
`;

describe('parseConfig', () => {
  it('fills a minimal configuration with safe defaults', () => {
    const parsed = parseConfig(minimal);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.value.modelAccess).toEqual({
      credentials: 'required',
      acceptRequesterSubscriptions: false,
    });
    expect(parsed.value.intake).toEqual({
      bundleBytes: 50 * 1024 * 1024,
      files: 500,
      submissionsPerMinute: 30,
    });
    const [acme] = parsed.value.projects;
    expect(acme).toMatchObject({
      id: 'acme-web',
      access: { kind: 'everyone' },
      repository: { host: 'github', name: 'acme/web', baseBranch: 'main' },
      publishing: { target: 'fork', draft: true },
      policy: { maxQuestions: 3, onReplyTimeout: 'proceed', replyTimeoutMs: 168 * 3_600_000 },
      execution: { model: 'claude-opus-5-5', timeoutMs: 45 * 60_000 },
    });
    expect(acme?.changePolicy).toEqual(DEFAULT_CHANGE_POLICY);
  });

  it('merges defaults under each project, and adds protections without dropping the default ones', () => {
    const parsed = parseConfig(`
models: { credentials: managed }
defaults:
  policy: { maxQuestions: 1 }
  changePolicy: { deny: [secrets] }
projects:
  - id: web
    name: Web
    access: { users: [ann] }
    repository: { host: github, name: acme/web, baseBranch: develop }
    policy: { onReplyTimeout: fail }
    changePolicy: { deny: [migrations], exempt: [Makefile, CLAUDE.md] }
`);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.errors).toEqual([
      'projects.web.changePolicy: exempt names no default protection: Makefile',
    ]);

    const fixed = parseConfig(`
models: { credentials: managed }
defaults:
  policy: { maxQuestions: 1 }
  changePolicy: { deny: [secrets] }
projects:
  - id: web
    name: Web
    access: { users: [ann] }
    repository: { host: github, name: acme/web, baseBranch: develop }
    policy: { onReplyTimeout: fail }
    changePolicy: { deny: [migrations], exempt: [CLAUDE.md] }
`);
    if (!fixed.ok) throw new Error(fixed.errors.join('\n'));
    const [web] = fixed.value.projects;
    expect(web?.policy).toMatchObject({ maxQuestions: 1, onReplyTimeout: 'fail' });
    expect(web?.access).toEqual({ kind: 'users', users: ['ann'] });
    expect(web?.changePolicy.deny).toContain('.github');
    expect(web?.changePolicy.deny).toContain('secrets');
    expect(web?.changePolicy.deny).toContain('migrations');
    expect(web?.changePolicy.deny).not.toContain('CLAUDE.md');
  });

  it('reports every problem with where it is', () => {
    const parsed = parseConfig(`
models: { credentials: sometimes }
projects:
  - id: Acme Web
    name: ''
    repository: { host: github, name: acme/web }
`);
    expect(parsed.ok ? [] : parsed.errors).toEqual([
      expect.stringMatching(/^models\.credentials: /),
      expect.stringMatching(/^projects\.0\.id: /),
      expect.stringMatching(/^projects\.0\.name: /),
    ]);
    expect(parseConfig('{ not: [yaml').ok).toBe(false);
  });

  it('refuses a project configured twice', () => {
    const twice = `${minimal}  - id: acme-web\n    name: Again\n    repository: { host: github, name: acme/other }\n`;
    expect(parseConfig(twice)).toEqual({
      ok: false,
      errors: ['projects: acme-web is configured twice'],
    });
  });
});

describe('ConfiguredProjects', () => {
  it('finds projects by id', () => {
    const parsed = parseConfig(minimal);
    if (!parsed.ok) throw new Error('invalid');
    const catalog = new ConfiguredProjects(parsed.value.projects);
    expect(catalog.get(ProjectId('acme-web'))?.name).toBe('Acme Web');
    expect(catalog.get(ProjectId('nope'))).toBeNull();
    expect(catalog.list()).toHaveLength(1);
  });
});
