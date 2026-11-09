import { describe, expect, it } from 'vitest';
import type { GrantTerms } from '../domain/grant';
import { RunId, TaskId } from '../domain/ids';
import { ModelCredential } from '../ports/access';
import { EgressGate, ModelGateway } from './gateway';
import { FixedClock, MemoryLedger, MemoryStore, silentLogger } from './testing/fakes';

const runId = RunId('run-1');
const taskId = TaskId('task-1');
const agentTerms = (credentials: 'operator' | 'requester' = 'operator'): GrantTerms => ({
  phase: 'agent',
  runId,
  taskId,
  model: 'claude-opus-5-5',
  credentials,
  budget: { usd: 1, tokens: 100_000 },
});

const sent = { model: 'claude-opus-5-5', max_tokens: 1000, messages: [], stream: true };
const body = sent;
const operatorKey = new ModelCredential('api-key', 'sk-operator');
const requesterToken = new ModelCredential('subscription', 'sk-ant-oat-requester');

/** A store holding the one grant of `terms`, and the token it was issued with. */
const issued = async (terms: GrantTerms) => {
  const store = new MemoryStore();
  return { store, token: await store.run((scope) => scope.grants.issue(terms)) };
};

const gateway = async (terms: GrantTerms, held: ModelCredential | null = null) => {
  const ledger = new MemoryLedger();
  const { store, token } = await issued(terms);
  const app = new ModelGateway({
    grants: store,
    ledger,
    prices: {
      priceOf: (model) =>
        model === 'claude-opus-5-5'
          ? { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }
          : null,
    },
    requesters: { credentialOf: () => held },
    operator: operatorKey,
    maxTokens: 64_000,
    clock: new FixedClock(5_000),
    logger: silentLogger,
  });
  return { app, ledger, token };
};

describe('ModelGateway', () => {
  it('lets a request through with the task’s credential in place of the grant, and meters it', async () => {
    const { app, ledger, token } = await gateway(agentTerms());
    const admitted = await app.admit(token, body, 'messages');
    if (!admitted.ok) throw new Error(admitted.refusal.kind);
    expect(admitted.admission.credential).toBe(operatorKey);
    expect(admitted.admission.stream).toBe(true);
    await app.meter(admitted.admission, {
      kind: 'measured',
      usage: { input: 100_000, output: 10_000, cacheWrite: 0, cacheRead: 0 },
    });
    expect(ledger.entries).toEqual([
      {
        reservation: 'reservation-1',
        request: { runId, taskId, model: 'claude-opus-5-5' },
        usage: { input: 100_000, output: 10_000, cacheWrite: 0, cacheRead: 0 },
        spending: { usd: 0.6, tokens: 110_000 },
        settled: true,
      },
    ]);
    expect(await app.status(token)).toEqual({ state: 'active' });
  });

  it('refuses a request without a grant for the agent phase', async () => {
    const { app, token } = await gateway({
      phase: 'setup',
      runId,
      taskId,
      hosts: ['registry.npmjs.org'],
    });
    expect(await app.admit(token, body, 'messages')).toEqual({
      ok: false,
      refusal: { kind: 'grant-revoked' },
    });
    expect(await app.admit(null, body, 'messages')).toMatchObject({ ok: false });
    expect(await app.status('unknown')).toEqual({
      state: 'refused',
      refusal: { kind: 'grant-revoked' },
    });
  });

  it('refuses what the rules forbid, and remembers it for the run to ask', async () => {
    const { app, token } = await gateway(agentTerms());
    const refused = await app.admit(token, { ...sent, model: 'claude-fable-5-1' }, 'messages');
    expect(refused).toMatchObject({ ok: false, refusal: { kind: 'request-refused' } });
    expect(await app.status(token)).toMatchObject({
      state: 'refused',
      refusal: { kind: 'request-refused' },
    });
  });

  it('holds the most a request can cost while it is in flight, and lets it go once answered', async () => {
    const { app, ledger, token } = await gateway(agentTerms());
    // $1 of budget: 1000 tokens of output, and a few of input, at $20 and $4 a million.
    const first = await app.admit(token, body, 'messages');
    const held = ledger.spentBy(taskId).usd;
    expect(held).toBeGreaterThan(0.02);
    expect(held).toBeLessThan(0.021);
    expect(first.ok).toBe(true);
    // A request that may cost more than what is left does not go, while the first is in flight.
    const large = { ...sent, max_tokens: 49_500 };
    expect(await app.admit(token, large, 'messages')).toMatchObject({
      refusal: { kind: 'budget-exhausted' },
    });
    if (!first.ok) throw new Error('refused');
    // An answer that did not say what it used keeps holding what it reserved.
    await app.meter(first.admission, { kind: 'unknown' });
    expect(ledger.spentBy(taskId).usd).toBe(held);
    await app.meter(first.admission, { kind: 'none' });
    // A request that used nothing frees what it held, and the large one fits alone.
    expect(ledger.spentBy(taskId).usd).toBe(0);
    expect(await app.admit(token, large, 'messages')).toMatchObject({ ok: true });
  });

  it('stops a task that spent its budget, but still counts its tokens', async () => {
    const { app, ledger, token } = await gateway(agentTerms());
    ledger.spend({ runId, taskId, model: 'claude-opus-5-5' }, { usd: 1, tokens: 2 });
    expect(await app.admit(token, body, 'messages')).toEqual({
      ok: false,
      refusal: { kind: 'budget-exhausted' },
    });
    expect(await app.admit(token, body, 'count-tokens')).toMatchObject({ ok: true });
  });

  it('runs a requester’s task with their credential, and waits for it when it is gone', async () => {
    const held = await gateway(agentTerms('requester'), requesterToken);
    const admitted = await held.app.admit(held.token, body, 'messages');
    expect(admitted.ok && admitted.admission.credential).toBe(requesterToken);
    const missing = await gateway(agentTerms('requester'), null);
    expect(await missing.app.admit(missing.token, body, 'messages')).toEqual({
      ok: false,
      refusal: { kind: 'credential-missing' },
    });
  });

  it('names a refused credential and a spent subscription limit from the provider’s answer', async () => {
    const { app, token } = await gateway(agentTerms('requester'), requesterToken);
    const admitted = await app.admit(token, body, 'messages');
    if (!admitted.ok) throw new Error('refused');
    expect(await app.inspect(admitted.admission, { status: 200, quotaResetAt: null })).toBeNull();
    expect(await app.inspect(admitted.admission, { status: 429, quotaResetAt: null })).toBeNull();
    expect(await app.inspect(admitted.admission, { status: 429, quotaResetAt: 9_000 })).toEqual({
      kind: 'quota-exhausted',
      resetAt: 9_000,
    });
    expect(await app.inspect(admitted.admission, { status: 401, quotaResetAt: null })).toEqual({
      kind: 'credential-refused',
    });
    expect(await app.status(token)).toEqual({
      state: 'refused',
      refusal: { kind: 'credential-refused' },
    });
  });
});

describe('EgressGate', () => {
  const authorize = async (terms: GrantTerms, host: string, port: number) => {
    const { store, token } = await issued(terms);
    return new EgressGate({ grants: store, logger: silentLogger }).authorize(token, host, port);
  };
  const setup: GrantTerms = { phase: 'setup', runId, taskId, hosts: ['registry.npmjs.org'] };

  it('opens a tunnel to a listed host on the TLS port with a setup grant', async () => {
    expect(await authorize(setup, 'registry.npmjs.org', 443)).toEqual({
      ok: true,
      runId,
    });
  });

  it.each([
    ['an agent grant', agentTerms(), 'registry.npmjs.org', 443],
    ['another host', setup, 'evil.example', 443],
    ['another port', setup, 'registry.npmjs.org', 80],
  ])('refuses %s', async (_name, terms, host, port) => {
    expect(await authorize(terms, host, port)).toMatchObject({ ok: false });
  });
});
