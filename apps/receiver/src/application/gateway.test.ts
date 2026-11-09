import { describe, expect, it } from 'vitest';
import type { Budget, GrantTerms } from '../domain/grant';
import { RunId, TaskId } from '../domain/ids';
import { ModelCredential } from '../ports/access';
import type { UsageEntry, UsageLedger } from '../ports/gateway';
import { EgressGate, ModelGateway } from './gateway';
import { FixedClock, MemoryGrantBook, silentLogger } from './testing/fakes';

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

class Ledger implements UsageLedger {
  readonly entries: UsageEntry[] = [];
  record(entry: UsageEntry) {
    this.entries.push(entry);
    return Promise.resolve();
  }
  spent(): Promise<Budget> {
    return Promise.resolve({
      usd: this.entries.reduce((sum, entry) => sum + entry.costUsd, 0),
      tokens: this.entries.reduce((sum, entry) => sum + entry.usage.input + entry.usage.output, 0),
    });
  }
}

const body = { model: 'claude-opus-5-5', max_tokens: 1000, messages: [], stream: true };
const operatorKey = new ModelCredential('api-key', 'sk-operator');
const requesterToken = new ModelCredential('subscription', 'sk-ant-oat-requester');

const gateway = (terms: GrantTerms, held: ModelCredential | null = null) => {
  const ledger = new Ledger();
  const app = new ModelGateway({
    grants: new MemoryGrantBook(new Map([['grant', terms]])),
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
  return { app, ledger };
};

describe('ModelGateway', () => {
  it('lets a request through with the task’s credential in place of the grant, and meters it', async () => {
    const { app, ledger } = gateway(agentTerms());
    const admitted = await app.admit('grant', body, 'messages');
    if (!admitted.ok) throw new Error(admitted.refusal.kind);
    expect(admitted.admission.credential).toBe(operatorKey);
    expect(admitted.admission.stream).toBe(true);
    await app.meter(admitted.admission, {
      input: 100_000,
      output: 10_000,
      cacheWrite: 0,
      cacheRead: 0,
    });
    expect(ledger.entries).toEqual([
      {
        runId,
        taskId,
        model: 'claude-opus-5-5',
        usage: { input: 100_000, output: 10_000, cacheWrite: 0, cacheRead: 0 },
        costUsd: 0.6,
        at: 5_000,
      },
    ]);
    expect(await app.status('grant')).toEqual({ state: 'active' });
  });

  it('refuses a request without a grant for the agent phase', async () => {
    const { app } = gateway({ phase: 'setup', runId, taskId, hosts: ['registry.npmjs.org'] });
    expect(await app.admit('grant', body, 'messages')).toEqual({
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
    const { app } = gateway(agentTerms());
    const refused = await app.admit('grant', { ...body, model: 'claude-fable-5-1' }, 'messages');
    expect(refused).toMatchObject({ ok: false, refusal: { kind: 'request-refused' } });
    expect(await app.status('grant')).toMatchObject({
      state: 'refused',
      refusal: { kind: 'request-refused' },
    });
  });

  it('stops a task that spent its budget, but still counts its tokens', async () => {
    const { app, ledger } = gateway(agentTerms());
    ledger.entries.push({
      runId,
      taskId,
      model: 'claude-opus-5-5',
      usage: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
      costUsd: 1,
      at: 0,
    });
    expect(await app.admit('grant', body, 'messages')).toEqual({
      ok: false,
      refusal: { kind: 'budget-exhausted' },
    });
    expect(await app.admit('grant', body, 'count-tokens')).toMatchObject({ ok: true });
  });

  it('runs a requester’s task with their credential, and waits for it when it is gone', async () => {
    const held = gateway(agentTerms('requester'), requesterToken);
    const admitted = await held.app.admit('grant', body, 'messages');
    expect(admitted.ok && admitted.admission.credential).toBe(requesterToken);
    const missing = gateway(agentTerms('requester'), null);
    expect(await missing.app.admit('grant', body, 'messages')).toEqual({
      ok: false,
      refusal: { kind: 'credential-missing' },
    });
  });

  it('names a refused credential and a spent subscription limit from the provider’s answer', async () => {
    const { app } = gateway(agentTerms('requester'), requesterToken);
    const admitted = await app.admit('grant', body, 'messages');
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
    expect(await app.status('grant')).toEqual({
      state: 'refused',
      refusal: { kind: 'credential-refused' },
    });
  });
});

describe('EgressGate', () => {
  const gate = (terms: GrantTerms) =>
    new EgressGate({
      grants: new MemoryGrantBook(new Map([['grant', terms]])),
      logger: silentLogger,
    });
  const setup: GrantTerms = { phase: 'setup', runId, taskId, hosts: ['registry.npmjs.org'] };

  it('opens a tunnel to a listed host on the TLS port with a setup grant', async () => {
    expect(await gate(setup).authorize('grant', 'registry.npmjs.org', 443)).toEqual({
      ok: true,
      runId,
    });
  });

  it.each([
    ['an agent grant', agentTerms(), 'registry.npmjs.org', 443],
    ['another host', setup, 'evil.example', 443],
    ['another port', setup, 'registry.npmjs.org', 80],
  ])('refuses %s', async (_name, terms, host, port) => {
    expect(await gate(terms).authorize('grant', host, port)).toMatchObject({ ok: false });
  });
});
