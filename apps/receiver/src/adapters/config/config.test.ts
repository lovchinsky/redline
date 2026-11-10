import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_CHANGE_POLICY } from '../../domain/change-policy';
import { ProjectId } from '../../domain/ids';
import type { HostedRepository } from '../../ports/source';
import { ConfiguredProjects, HostedProjects, parseConfig } from './config';

const minimal = `
agent: { kind: scripted }
git: { kind: scripted }
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
      operator: null,
      acceptRequesterSubscriptions: false,
    });
    expect(parsed.value.gateway).toMatchObject({
      upstream: 'https://api.anthropic.com',
      operator: null,
    });
    expect(parsed.value.agent).toEqual({ kind: 'scripted', durationMs: 5000, asks: true });
    expect(parsed.value.intake).toEqual({
      bundleBytes: 50 * 1024 * 1024,
      files: 500,
      submissionsPerMinute: 30,
    });
    const [acme] = parsed.value.projects.kind === 'listed' ? parsed.value.projects.projects : [];
    expect(acme).toMatchObject({
      id: 'acme-web',
      access: { kind: 'everyone' },
      repository: { host: 'github', name: 'acme/web', baseBranch: 'main' },
      publishing: { target: 'branch', draft: true },
      policy: { maxQuestions: 3, onReplyTimeout: 'proceed', replyTimeoutMs: 168 * 3_600_000 },
      execution: { model: 'claude-opus-5-5', timeoutMs: 45 * 60_000 },
    });
    expect(acme?.changePolicy).toEqual(DEFAULT_CHANGE_POLICY);
  });

  it('merges defaults under each project, and adds protections without dropping the default ones', () => {
    const parsed = parseConfig(`
agent: { kind: scripted }
git: { kind: scripted }
models: { credentials: required }
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
agent: { kind: scripted }
git: { kind: scripted }
models: { credentials: required }
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
    const [web] = fixed.value.projects.kind === 'listed' ? fixed.value.projects.projects : [];
    expect(web?.policy).toMatchObject({ maxQuestions: 1, onReplyTimeout: 'fail' });
    expect(web?.access).toEqual({ kind: 'users', users: ['ann'] });
    expect(web?.changePolicy.deny).toContain('.github');
    expect(web?.changePolicy.deny).toContain('secrets');
    expect(web?.changePolicy.deny).toContain('migrations');
    expect(web?.changePolicy.deny).not.toContain('CLAUDE.md');
  });

  it('reports every problem with where it is', () => {
    const parsed = parseConfig(`
agent: { kind: scripted }
git: { kind: scripted }
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
    if (parsed.value.projects.kind !== 'listed') throw new Error('not listed');
    const catalog = new ConfiguredProjects(parsed.value.projects.projects);
    expect(catalog.get(ProjectId('acme-web'))?.name).toBe('Acme Web');
    expect(catalog.get(ProjectId('nope'))).toBeNull();
    expect(catalog.list()).toHaveLength(1);
  });

  it('asks where the operator’s credential is when tasks may run with it, and for every model’s price', () => {
    const parsed = parseConfig(`
agent: { kind: scripted }
git: { kind: scripted }
models: { credentials: optional }
projects:
  - id: web
    name: Web
    repository: { host: github, name: acme/web }
    execution: { model: claude-next }
`);
    expect(parsed.ok ? [] : parsed.errors).toEqual([
      "models.operator: tasks run with the operator's credential (credentials: optional); say where it is",
      'projects.web.execution.model: no price for claude-next; set models.prices',
    ]);
    const priced = parseConfig(`
agent: { kind: scripted }
git: { kind: scripted }
models:
  credentials: optional
  operator: { kind: subscription, secretFile: /run/secrets/claude }
  prices: { claude-next: { input: 1, output: 2, cacheWrite: 1.25, cacheRead: 0.1 } }
gateway: { upstream: 'https://llm.internal.example', maxTokens: 64000 }
projects:
  - id: web
    name: Web
    repository: { host: github, name: acme/web }
    execution: { model: claude-next }
`);
    if (!priced.ok) throw new Error(priced.errors.join('\n'));
    expect(priced.value.modelAccess.operator).toBe('subscription');
    expect(priced.value.gateway).toMatchObject({
      upstream: 'https://llm.internal.example',
      maxTokens: 64_000,
      operator: { kind: 'subscription', secretFile: '/run/secrets/claude' },
    });
    expect(priced.value.gateway.prices['claude-next']).toEqual({
      input: 1,
      output: 2,
      cacheWrite: 1.25,
      cacheRead: 0.1,
    });
  });

  it('reads a sandboxed agent on local repositories, isolated by gVisor unless waived', () => {
    const source = (isolation: string, host = 'local', git = 'local, root: /srv/git') => `
agent:
  kind: claude
  ${isolation}
  networks: { setup: redline-setup, agent: redline-agent }
  gateway: { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' }
  limits: { memoryMegabytes: 2048 }
git: { kind: ${git} }
models: { credentials: required }
projects:
  - id: web
    name: Web
    repository: { host: ${host}, name: acme/web.git }
`;
    const parsed = parseConfig(source(''));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.value.agent).toMatchObject({
      kind: 'claude',
      runtime: 'runsc',
      dockerSocket: '/var/run/docker.sock',
      user: { uid: 1000, gid: 1000 },
      limits: { cpus: 2, memoryBytes: 2048 * 1024 * 1024, pids: 1024 },
      setupTimeoutMs: 15 * 60_000,
    });
    expect(parsed.value.git).toMatchObject({ kind: 'local', root: '/srv/git' });
    // A sandboxed agent need not be named so: it is the agent when none is.
    const unnamed = parseConfig(
      'agent: { isolation: auto }\ngit: { kind: github, auth: { token: { file: /t } } }\nmodels: { credentials: required }\n',
    );
    expect(unnamed.ok && unnamed.value.agent).toMatchObject({ kind: 'claude', runtime: 'auto' });
    const auto = parseConfig(source('isolation: auto'));
    expect(auto.ok && auto.value.agent.kind === 'claude' && auto.value.agent.runtime).toBe('auto');
    const waived = parseConfig(source('isolation: unsafe-runc'));
    expect(waived.ok && waived.value.agent.kind === 'claude' && waived.value.agent.runtime).toBe(
      'runc',
    );
    expect(parseConfig(source('', 'github'))).toMatchObject({ ok: false });
    expect(parseConfig(source('', 'local', 'scripted'))).toMatchObject({
      ok: false,
      errors: ['git: the claude agent works on real repositories; the scripted git host has none'],
    });
  });

  it('reads GitHub as the git host, whose repositories are the projects', () => {
    const app =
      '{ kind: github, auth: { app: { id: 12345, privateKeyFile: /run/secrets/app.pem } }, fork: { owner: redline-bot } }';
    const parsed = parseConfig(`git: ${app}\nmodels: { credentials: required }\n`);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.value.git).toEqual({
      kind: 'github',
      api: 'https://api.github.com',
      web: 'https://github.com',
      auth: { kind: 'app', appId: '12345', privateKeyFile: '/run/secrets/app.pem' },
      forkOwner: 'redline-bot',
      commitAs: { name: 'Redline', email: 'redline@users.noreply.github.com' },
      gitleaks: 'gitleaks',
    });
    // No agent named: Claude Code in the sandboxes the compose files set up.
    expect(parsed.value.agent).toMatchObject({
      kind: 'claude',
      runtime: 'runsc',
      networks: { setup: 'redline-sandbox-setup', agent: 'redline-sandbox-agent' },
      gateway: { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' },
    });
    const source = parsed.value.projects;
    if (source.kind !== 'hosted') throw new Error('not hosted');
    // A repository the configuration says nothing about: the defaults, published to a branch.
    expect(source.projectOf({ name: 'acme/web', baseBranch: 'develop' })).toMatchObject({
      id: 'acme/web',
      name: 'acme/web',
      repository: { host: 'github', name: 'acme/web', baseBranch: 'develop' },
      publishing: { target: 'branch', draft: true },
      access: { kind: 'everyone' },
    });
  });

  it('shapes the repositories it names, and hides those it is told to', () => {
    const parsed = parseConfig(`
git: { kind: github, auth: { token: { file: /run/secrets/pat } }, fork: { owner: redline-bot } }
models: { credentials: required }
defaults:
  execution: { budgetUsd: 3 }
  publishing: { draft: false }
projects:
  - repository: { name: Acme/Web }
    name: Acme Web
    publishing: { target: fork }
    execution: { timeoutMinutes: 90 }
  - repository: { name: acme/secret }
    hidden: true
`);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const source = parsed.value.projects;
    if (source.kind !== 'hosted') throw new Error('not hosted');
    expect(source.named).toEqual(['Acme/Web', 'acme/secret']);
    expect(source.projectOf({ name: 'acme/web', baseBranch: 'main' })).toMatchObject({
      id: 'acme/web',
      name: 'Acme Web',
      publishing: { target: 'fork', draft: false },
      execution: { budget: { usd: 3 }, timeoutMs: 90 * 60_000 },
    });
    expect(source.projectOf({ name: 'acme/secret', baseBranch: 'main' })).toBeNull();
    expect(parsed.value.longestRunMs).toBe(90 * 60_000);
  });

  it('refuses ids, other hosts and forks without an owner, for GitHub’s repositories', () => {
    const parsed = parseConfig(`
git: { kind: github, auth: { token: { file: /run/secrets/pat } } }
models: { credentials: required }
projects:
  - { id: web, repository: { name: acme/web } }
  - { repository: { host: local, name: acme/api } }
  - { repository: { name: acme/docs }, publishing: { target: fork } }
`);
    expect(parsed.ok ? [] : parsed.errors).toEqual([
      'projects[0].id: with git: github a project is its repository; drop the id',
      'projects[1].repository: git is github, so its host is github and its name owner/repo',
      'projects[2].publishing: it publishes to a fork; set git.fork.owner',
    ]);
  });
});

describe('HostedProjects', () => {
  it('offers the repositories found last, as the configuration shapes them', async () => {
    const parsed = parseConfig(`
git: { kind: github, auth: { token: { file: /run/secrets/pat } } }
models: { credentials: required }
projects:
  - { repository: { name: acme/secret }, hidden: true }
`);
    if (!parsed.ok || parsed.value.projects.kind !== 'hosted') throw new Error('not hosted');
    let found: readonly HostedRepository[] = [
      { name: 'acme/web', baseBranch: 'main' },
      { name: 'acme/secret', baseBranch: 'main' },
    ];
    const catalog = new HostedProjects(parsed.value.projects, {
      replace: () => Promise.resolve(),
      list: () => Promise.resolve(found),
    });
    expect(catalog.list()).toEqual([]);
    await catalog.refresh();
    expect(catalog.list().map((project) => project.id)).toEqual(['acme/web']);
    expect(catalog.get(ProjectId('acme/web'))?.repository.baseBranch).toBe('main');
    found = [{ name: 'acme/api', baseBranch: 'trunk' }];
    await catalog.refresh();
    expect(catalog.get(ProjectId('acme/web'))).toBeNull();
    expect(catalog.get(ProjectId('acme/api'))?.repository.baseBranch).toBe('trunk');
  });
});

describe('the deployment files', () => {
  const deploy = path.resolve(import.meta.dirname, '../../../deploy');
  const read = (file: string) => readFileSync(path.join(deploy, file), 'utf8');

  it('hold configurations the receiver accepts: the example, and the local profile’s inline one', () => {
    const compose = parse(read('compose.local.yaml')) as {
      configs: { receiver: { content: string } };
    };
    for (const text of [read('receiver.example.yaml'), compose.configs.receiver.content]) {
      const parsed = parseConfig(text);
      expect(parsed.ok ? [] : parsed.errors).toEqual([]);
    }
  });
});
