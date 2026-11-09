import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  IDEMPOTENCY_KEY_HEADER,
  MANIFEST_PART,
  MODEL_CREDENTIAL_HEADER,
  MODEL_CREDENTIAL_KIND_HEADER,
  PROJECT_PART,
} from '@redline/contract';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialRelay } from '../../application/credentials';
import { TaskRequests } from '../../application/requests';
import { SuperviseRun } from '../../application/supervise-run';
import { TaskWriter } from '../../application/task-writer';
import {
  FakeCatalog,
  FakeGit,
  FakeIdentity,
  FakeRunner,
  FixedClock,
  MemoryStore,
  MemoryVault,
  SequentialIds,
  silentLogger,
} from '../../application/testing/fakes';
import { QuestionId } from '../../domain/ids';
import type { ModelAccessPolicy } from '../../ports/access';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { StoredBundles } from '../blobs/stored-bundles';
import { DEFAULT_POLLING } from './presenter';
import { buildApi } from './server';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'redline-http-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encode = (text: string) => new TextEncoder().encode(text);

const CONTEXT = encode('# Redline task\n\n> Rename "Most popular" to "Best value"\n');

const manifestOf = (files: Record<string, Uint8Array>) => ({
  schemaVersion: 1,
  taskId: 'draft-1',
  createdAt: '2026-11-09T10:00:00.000Z',
  client: { version: '0.1.0' },
  steps: [
    {
      id: 'step-1',
      url: 'https://staging.acme.io/pricing',
      routePattern: '/pricing',
      comment: 'Rename "Most popular" to "Best value"',
      viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
      shapes: [{ id: 'shape-1', files: [] }],
    },
  ],
  files: Object.entries(files).map(([filePath, bytes]) => ({
    path: filePath,
    mediaType: 'text/markdown',
    sha256: sha(bytes),
    bytes: bytes.byteLength,
  })),
  entry: 'context.md',
});

/** A multipart body as the extension's client sends it. */
const body = async (parts: {
  manifest?: unknown;
  projectId?: string;
  files?: Record<string, Uint8Array>;
}) => {
  const form = new FormData();
  if (parts.manifest !== undefined) {
    form.append(
      MANIFEST_PART,
      new Blob([JSON.stringify(parts.manifest)], { type: 'application/json' }),
      'manifest.json',
    );
  }
  if (parts.projectId !== undefined) form.append(PROJECT_PART, parts.projectId);
  for (const [filePath, bytes] of Object.entries(parts.files ?? {}))
    form.append(filePath, new Blob([bytes]), filePath);
  const response = new Response(form);
  return {
    payload: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? '',
  };
};

const harness = async (
  access: ModelAccessPolicy = { credentials: 'managed', acceptRequesterSubscriptions: false },
) => {
  const store = new MemoryStore();
  const clock = new FixedClock();
  const ids = new SequentialIds();
  const catalog = new FakeCatalog();
  const blobs = new FsBlobStore(root);
  const bundles = new StoredBundles(blobs);
  const vault = new MemoryVault();
  const writer = new TaskWriter({ uow: store, clock });
  const relay = new CredentialRelay({ vault, writer, policy: access, logger: silentLogger });
  const requests = new TaskRequests({
    queries: store,
    writer,
    projects: catalog,
    bundles,
    vault,
    relay,
    access,
    ids,
    clock,
  });
  const runner = new FakeRunner();
  const git = new FakeGit();
  const supervise = new SuperviseRun({
    queries: store,
    uow: store,
    writer,
    projects: catalog,
    bundles,
    source: git,
    runner,
    vault,
    ids,
    clock,
    logger: silentLogger,
  });
  const app = await buildApi({
    requests,
    identity: new FakeIdentity(),
    blobs,
    intake: { bundleBytes: 4096, files: 3, submissionsPerMinute: 2 },
    polling: DEFAULT_POLLING,
    clock,
    logger: silentLogger,
  });
  return { app, store, runner, supervise, vault };
};

const ANN = { authorization: 'Bearer token-ann' };
const BOB = { authorization: 'Bearer token-bob' };

const submit = async (
  app: FastifyInstance,
  parts: Parameters<typeof body>[0],
  headers: Record<string, string> = {},
) => {
  const { payload, contentType } = await body(parts);
  return app.inject({
    method: 'POST',
    url: '/v1/tasks',
    payload,
    headers: {
      ...ANN,
      'content-type': contentType,
      [IDEMPOTENCY_KEY_HEADER]: 'delivery-1',
      ...headers,
    },
  });
};

const valid = {
  manifest: manifestOf({ 'context.md': CONTEXT }),
  projectId: 'acme',
  files: { 'context.md': CONTEXT },
};

describe('receiver-api.v1 over HTTP', () => {
  it('refuses requests without a valid token', async () => {
    const { app } = await harness();
    expect((await app.inject({ method: 'GET', url: '/v1/projects' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.json()).toEqual({
      error: { code: 'unauthorized', message: 'A valid access token is required' },
    });
  });

  it('lists projects with the receiver’s credential policy', async () => {
    const { app } = await harness({ credentials: 'required', acceptRequesterSubscriptions: false });
    const listed = await app.inject({ method: 'GET', url: '/v1/projects', headers: ANN });
    expect(listed.json()).toEqual({
      projects: [{ id: 'acme', name: 'Acme Web' }],
      modelCredential: 'required',
    });
  });

  it('accepts a bundle whatever the order of its parts, once per idempotency key', async () => {
    const { app, store } = await harness();
    const first = await submit(app, {
      files: valid.files,
      projectId: 'acme',
      manifest: valid.manifest,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ status: { phase: 'queued' }, pollAfterSec: 30 });
    expect(first.json<{ remoteId: unknown }>().remoteId).toEqual(expect.stringMatching(/./));
    const again = await submit(app, valid);
    expect(again.json()).toEqual(first.json());
    expect(store.state.tasks.size).toBe(1);
  });

  it.each([
    [
      'a file that does not match its hash',
      { ...valid, files: { 'context.md': encode('changed') } },
      'does not match its hash',
    ],
    ['a missing file', { ...valid, files: {} }, 'File context.md is missing'],
    [
      'a part not in the manifest',
      { ...valid, files: { ...valid.files, 'extra.md': encode('x') } },
      'Parts not in the manifest: extra.md',
    ],
    [
      'a missing manifest',
      { projectId: 'acme', files: valid.files },
      'The manifest part is missing',
    ],
    [
      'a missing project',
      { manifest: valid.manifest, files: valid.files },
      'The projectId part is missing',
    ],
    [
      'an invalid manifest',
      { ...valid, manifest: { schemaVersion: 9 } },
      'The manifest is invalid',
    ],
    ['an unknown project', { ...valid, projectId: 'nope' }, 'Unknown project'],
  ])('refuses a bundle with %s', async (_, parts, message) => {
    const { app } = await harness();
    const refused = await submit(app, parts);
    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ error: { message: string } }>().error.message).toContain(message);
  });

  it('refuses a bundle file named like a field of the request', async () => {
    const { app } = await harness();
    const files = { [PROJECT_PART]: CONTEXT };
    const refused = await submit(app, { manifest: manifestOf(files), projectId: 'acme', files });
    expect(refused.statusCode).toBe(422);
  });

  it('refuses a bundle that is too large or has too many files, with 413', async () => {
    const { app } = await harness();
    const big = new Uint8Array(5000);
    expect(
      (
        await submit(app, {
          manifest: manifestOf({ 'a.bin': big }),
          projectId: 'acme',
          files: { 'a.bin': big },
        })
      ).statusCode,
    ).toBe(413);
    const many = Object.fromEntries(
      ['a', 'b', 'c', 'd'].map((name) => [`${name}.md`, encode(name)]),
    );
    expect(
      (
        await submit(
          app,
          { manifest: manifestOf(many), projectId: 'acme', files: many },
          { [IDEMPOTENCY_KEY_HEADER]: 'k2' },
        )
      ).statusCode,
    ).toBe(413);
  });

  it('requires an idempotency key and limits submissions per user', async () => {
    const { app } = await harness();
    expect((await submit(app, valid, { [IDEMPOTENCY_KEY_HEADER]: '' })).statusCode).toBe(400);
    expect((await submit(app, valid, { [IDEMPOTENCY_KEY_HEADER]: 'k1' })).statusCode).toBe(200);
    expect((await submit(app, valid, { [IDEMPOTENCY_KEY_HEADER]: 'k2' })).statusCode).toBe(200);
    const limited = await submit(app, valid, { [IDEMPOTENCY_KEY_HEADER]: 'k3' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    // A repeat of a taken submission is never limited.
    expect((await submit(app, valid, { [IDEMPOTENCY_KEY_HEADER]: 'k1' })).statusCode).toBe(200);
  });

  it('reports a task to its requester only, and an unknown task as unknown-task', async () => {
    const { app } = await harness();
    const { remoteId } = (await submit(app, valid)).json<{ remoteId: string }>();
    expect(
      (await app.inject({ method: 'GET', url: `/v1/tasks/${remoteId}`, headers: ANN })).json(),
    ).toMatchObject({
      remoteId,
      status: { phase: 'queued' },
    });
    for (const [url, headers] of [
      [`/v1/tasks/${remoteId}`, BOB],
      ['/v1/tasks/unknown', ANN],
    ] as const) {
      const missing = await app.inject({ method: 'GET', url, headers });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: 'unknown-task' } });
    }
  });

  it('shows the agent’s question and takes the answer', async () => {
    const { app, runner, supervise, store } = await harness();
    const { remoteId } = (await submit(app, valid)).json<{ remoteId: string }>();
    runner.outcomes.push({
      kind: 'question',
      question: {
        id: QuestionId('q1'),
        text: 'Every breakpoint?',
        options: ['Yes', 'Desktop only'],
      },
      snapshot: null,
    });
    const taskId = [...store.state.tasks.keys()][0];
    if (taskId === undefined) throw new Error('No task');
    await supervise.handle(taskId, new AbortController().signal);
    const asked = await app.inject({ method: 'GET', url: `/v1/tasks/${remoteId}`, headers: ANN });
    expect(asked.json()).toMatchObject({
      status: {
        phase: 'needs-input',
        question: { id: 'q1', text: 'Every breakpoint?', options: ['Yes', 'Desktop only'] },
      },
      pollAfterSec: 60,
    });
    const reply = (questionId: string, text: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/tasks/${remoteId}/replies`,
        headers: ANN,
        payload: { questionId, text },
      });
    expect((await reply('q1', 'Yes')).json()).toMatchObject({ status: { phase: 'queued' } });
    expect((await reply('q1', 'Yes')).statusCode).toBe(200);
    expect((await reply('q1', 'No')).statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/tasks/${remoteId}/replies`,
          headers: ANN,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
  });

  it('takes the requester’s credential from its headers and refuses malformed ones', async () => {
    const { app, vault } = await harness({
      credentials: 'required',
      acceptRequesterSubscriptions: false,
    });
    expect((await submit(app, valid)).statusCode).toBe(422);
    const withKey = await submit(app, valid, {
      [MODEL_CREDENTIAL_HEADER]: 'sk-ant-api-secret',
      [MODEL_CREDENTIAL_KIND_HEADER]: 'api-key',
      [IDEMPOTENCY_KEY_HEADER]: 'k2',
    });
    expect(withKey.statusCode).toBe(200);
    expect([...vault.held.values()].map((credential) => credential.reveal())).toEqual([
      'sk-ant-api-secret',
    ]);
    const malformed = await submit(app, valid, {
      [MODEL_CREDENTIAL_HEADER]: 'secret',
      [IDEMPOTENCY_KEY_HEADER]: 'k3',
    });
    expect(malformed.statusCode).toBe(400);
    const unknownKind = await submit(app, valid, {
      [MODEL_CREDENTIAL_HEADER]: 'secret',
      [MODEL_CREDENTIAL_KIND_HEADER]: 'password',
      [IDEMPOTENCY_KEY_HEADER]: 'k4',
    });
    expect(unknownKind.statusCode).toBe(400);
  });
});
