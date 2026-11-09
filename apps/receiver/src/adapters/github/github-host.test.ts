import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixedClock, silentLogger } from '../../application/testing/fakes';
import type { RepositoryRef } from '../../ports/access';
import { GitHubApi } from './api';
import { AppAuth, TokenAuth } from './auth';
import { DRAFT_LABEL, GitHubHost } from './github-host';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const repository: RepositoryRef = { host: 'github', name: 'acme/web', baseBranch: 'main' };
const draft = {
  branch: 'redline/task-1',
  title: 'Redline: Make the cards equal height',
  body: 'body',
  draft: true,
  labels: ['redline'],
};

interface Call {
  readonly method: string;
  readonly path: string;
  readonly authorization: string;
  readonly body: unknown;
}

/** GitHub's API as far as the receiver uses it, answering from `routes`. */
const fakeGitHub = (
  routes: (call: Call) => { status: number; body?: unknown; headers?: Record<string, string> },
) => {
  const calls: Call[] = [];
  const fetchStub = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const call = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      authorization: headers.get('authorization') ?? '',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const answer = routes(call);
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: answer.headers ?? {},
      }),
    );
  };
  return {
    calls,
    api: new GitHubApi({ url: 'https://api.github.test', fetch: fetchStub }),
  };
};

const appJwtIsValid = (authorization: string) => {
  const [header = '', payload = '', signature = ''] = authorization
    .replace('Bearer ', '')
    .split('.');
  return verify(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
};

const pull = (number: number) => ({
  number,
  html_url: `https://github.test/acme/web/pull/${String(number)}`,
});

const host = (
  api: GitHubApi,
  auth = new TokenAuth('pat-token'),
  forkOwner: string | null = 'redline-bot',
) => new GitHubHost({ api, auth, gitUrl: 'https://github.test', forkOwner, logger: silentLogger });

describe('AppAuth', () => {
  it('asks for a token of one repository with publishing’s permissions, and keeps it until it nearly expires', async () => {
    const clock = new FixedClock(Date.UTC(2026, 10, 9, 12));
    const { calls, api } = fakeGitHub((call) => {
      if (call.path === '/repos/acme/web/installation') return { status: 200, body: { id: 42 } };
      if (call.path === '/app/installations/42/access_tokens') {
        return {
          status: 201,
          body: { token: 'ghs_installation', expires_at: '2026-11-09T13:00:00Z' },
        };
      }
      return { status: 404 };
    });
    const auth = new AppAuth({
      api,
      appId: 'Iv1.redline',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      clock,
    });
    expect(await auth.tokenFor('acme/web')).toBe('ghs_installation');
    expect(await auth.tokenFor('acme/web')).toBe('ghs_installation');
    expect(calls.map((call) => call.path)).toEqual([
      '/repos/acme/web/installation',
      '/app/installations/42/access_tokens',
    ]);
    expect(calls.every((call) => appJwtIsValid(call.authorization))).toBe(true);
    expect(calls[1]?.body).toEqual({
      repositories: ['web'],
      permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' },
    });
    // Past five minutes before it expires, a new one.
    clock.time = Date.UTC(2026, 10, 9, 12, 56);
    await auth.tokenFor('acme/web');
    expect(calls).toHaveLength(3);
  });
});

describe('GitHubHost', () => {
  it('reaches a repository with its token as git credentials, and a fork for a fork’s branch', async () => {
    const { api } = fakeGitHub(() => ({ status: 404 }));
    const github = host(api);
    const basic = `Basic ${Buffer.from('x-access-token:pat-token').toString('base64')}`;
    expect(await github.source(repository)).toEqual({
      url: 'https://github.test/acme/web.git',
      authorization: basic,
    });
    expect(await github.target(repository, { target: 'fork', draft: true })).toEqual({
      url: 'https://github.test/redline-bot/web.git',
      authorization: basic,
    });
    expect(await github.target(repository, { target: 'branch', draft: true })).toMatchObject({
      url: 'https://github.test/acme/web.git',
    });
    expect(await github.source({ ...repository, host: 'local' })).toBeNull();
  });

  it('finds the open pull request of a task’s branch, from the fork or the repository', async () => {
    const { calls, api } = fakeGitHub(() => ({ status: 200, body: [pull(7)] }));
    expect(
      await host(api).findOpen(repository, { target: 'fork', draft: true }, 'redline/task-1'),
    ).toEqual({
      ok: true,
      value: { id: '7', url: 'https://github.test/acme/web/pull/7' },
    });
    expect(calls[0]?.path).toBe(
      '/repos/acme/web/pulls?state=open&head=redline-bot%3Aredline%2Ftask-1&per_page=1',
    );
    await host(api).findOpen(repository, { target: 'branch', draft: true }, 'redline/task-1');
    expect(calls[1]?.path).toContain('head=acme%3Aredline%2Ftask-1');
  });

  it('opens a draft pull request and labels it', async () => {
    const { calls, api } = fakeGitHub((call) =>
      call.path === '/repos/acme/web/pulls'
        ? { status: 201, body: pull(8) }
        : { status: 200, body: [] },
    );
    const opened = await host(api).open(repository, { target: 'fork', draft: true }, draft);
    expect(opened).toEqual({
      ok: true,
      value: { id: '8', url: 'https://github.test/acme/web/pull/8' },
    });
    expect(calls[0]?.body).toEqual({
      title: draft.title,
      head: 'redline-bot:redline/task-1',
      base: 'main',
      body: 'body',
      maintainer_can_modify: false,
      draft: true,
    });
    expect(calls[1]).toMatchObject({
      path: '/repos/acme/web/issues/8/labels',
      body: { labels: ['redline'] },
    });
  });

  it('opens an ordinary pull request labelled as a draft where drafts are not available', async () => {
    let attempts = 0;
    const { calls, api } = fakeGitHub((call) => {
      if (call.path !== '/repos/acme/web/pulls') return { status: 200, body: [] };
      attempts += 1;
      return attempts === 1
        ? {
            status: 422,
            body: { message: 'Draft pull requests are not supported in this repository.' },
          }
        : { status: 201, body: pull(9) };
    });
    expect(
      await host(api).open(repository, { target: 'branch', draft: true }, draft),
    ).toMatchObject({ ok: true });
    expect(calls[1]?.body).toMatchObject({ draft: false, head: 'acme:redline/task-1' });
    expect(calls[2]?.body).toEqual({ labels: ['redline', DRAFT_LABEL] });
  });

  it('retries what may pass, and names what will not', async () => {
    const answer = (
      status: number,
      headers: Record<string, string> = {},
      body: unknown = { message: 'no' },
    ) =>
      host(fakeGitHub(() => ({ status, headers, body })).api).findOpen(
        repository,
        { target: 'branch', draft: true },
        'b',
      );
    expect(await answer(502)).toMatchObject({ ok: false, error: { transient: true } });
    expect(await answer(403, { 'x-ratelimit-remaining': '0' })).toMatchObject({
      ok: false,
      error: { transient: true },
    });
    expect(
      await answer(403, {}, { message: 'You have exceeded a secondary rate limit' }),
    ).toMatchObject({
      ok: false,
      error: { transient: true },
    });
    expect(await answer(404, {}, { message: 'Not Found' })).toMatchObject({
      ok: false,
      error: { transient: false, detail: expect.stringContaining('404: Not Found') as string },
    });
  });

  it('closes a pull request', async () => {
    const { calls, api } = fakeGitHub(() => ({ status: 200, body: pull(7) }));
    expect(await host(api).close(repository, { id: '7', url: '' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/repos/acme/web/pulls/7',
      body: { state: 'closed' },
    });
  });

  it('checks that a fork target is the bot’s fork of the repository', async () => {
    const answers: Record<string, unknown> = {
      '/repos/redline-bot/web': { full_name: 'redline-bot/web', parent: { full_name: 'acme/web' } },
      '/repos/acme/web': { full_name: 'acme/web' },
    };
    const { api } = fakeGitHub((call) =>
      call.path in answers
        ? { status: 200, body: answers[call.path] }
        : { status: 404, body: { message: 'Not Found' } },
    );
    expect(await host(api).checkTarget(repository, { target: 'fork', draft: true })).toEqual({
      ok: true,
      value: 'redline-bot/web',
    });
    expect(await host(api).checkTarget(repository, { target: 'branch', draft: true })).toEqual({
      ok: true,
      value: 'acme/web',
    });
    answers['/repos/redline-bot/web'] = {
      full_name: 'redline-bot/web',
      parent: { full_name: 'someone/else' },
    };
    expect(await host(api).checkTarget(repository, { target: 'fork', draft: true })).toMatchObject({
      ok: false,
      error: { detail: 'redline-bot/web is not a fork of acme/web' },
    });
  });
});
