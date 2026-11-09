import * as z from 'zod/mini';
import { BlobDigest, ProjectId, QuestionId, RunId, TaskId, UserId } from '../../domain/ids';
import type { GatewayRefusal, GrantTerms } from '../../domain/grant';
import type { Run } from '../../domain/run';
import type { Task, TaskEvent } from '../../domain/task';

/**
 * How tasks and runs are stored: one JSON record each, validated whenever it is read. The record
 * carries its format; a reader of a newer format converts older records (append-only, like the
 * migrations) instead of reading them as the current one.
 */
export const RECORD_FORMAT = 1;

const text = z.string().check(z.minLength(1));
const instant = z.number();
const sha = z.string().check(z.regex(/^[0-9a-f]{40}$/));
/** A non-empty string read as the id it names. */
const id = <T>(name: (value: string) => T) => z.pipe(text, z.transform(name));
const digest = z.pipe(z.string().check(z.regex(/^[a-f0-9]{64}$/)), z.transform(BlobDigest));

const snapshot = z.object({
  blob: digest,
  image: text,
  model: text,
  questionId: z.nullable(id(QuestionId)),
});

const question = z.object({
  id: id(QuestionId),
  text: text,
  options: z.array(text),
});

const answer = z.discriminatedUnion('source', [
  z.object({ source: z.literal('requester'), text: z.string(), at: instant }),
  z.object({ source: z.literal('timeout'), at: instant }),
]);

const exchange = z.object({
  question,
  askedAt: instant,
  answer: z.nullable(answer),
  closed: z.boolean(),
});

const report = z.object({
  summary: z.string(),
  changes: z.array(z.object({ file: z.string(), why: z.string() })),
  verification: z.string(),
  assumptions: z.array(z.string()),
});

const failureCode = z.enum([
  'no-change',
  'policy-rejected',
  'budget-exhausted',
  'agent-failed',
  'setup-failed',
  'repository-unavailable',
  'publish-failed',
  'no-reply',
  'model-access-failed',
]);

const state = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('queued'),
    resumeFrom: z.nullable(snapshot),
    awaiting: z.nullable(z.literal('credential')),
  }),
  z.object({ kind: z.literal('running'), runId: id(RunId), resumedFrom: z.nullable(snapshot) }),
  z.object({
    kind: z.literal('awaiting-reply'),
    questionId: id(QuestionId),
    snapshot: z.nullable(snapshot),
  }),
  z.object({
    kind: z.literal('publishing'),
    change: z.object({ blob: digest, head: sha }),
    report,
  }),
  z.object({ kind: z.literal('published'), changeRequest: z.object({ id: text, url: text }) }),
  z.object({
    kind: z.literal('failed'),
    failure: z.object({ code: failureCode, message: z.string() }),
  }),
  z.object({ kind: z.literal('cancelled'), reason: z.string() }),
]);

const taskRecord = z.object({
  format: z.literal(RECORD_FORMAT),
  id: id(TaskId),
  requester: id(UserId),
  projectId: id(ProjectId),
  bundle: z.object({ manifest: digest, title: z.string() }),
  credentials: z.enum(['requester', 'operator']),
  baseSha: z.nullable(text),
  state,
  exchanges: z.array(exchange),
  runAttempts: z.int(),
  publishAttempts: z.int(),
  createdAt: instant,
  updatedAt: instant,
});

const runFailureReason = z.enum([
  'infra',
  'setup-failed',
  'repository-unavailable',
  'budget-exhausted',
  'agent-failed',
  'model-access-failed',
]);

const outcome = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), question, snapshot: z.nullable(snapshot) }),
  z.object({ kind: z.literal('change'), change: z.object({ blob: digest, head: sha }), report }),
  z.object({ kind: z.literal('no-change'), explanation: z.string() }),
  z.object({
    kind: z.literal('quota-exhausted'),
    resetAt: instant,
    snapshot: z.nullable(snapshot),
  }),
  z.object({ kind: z.literal('credential-missing'), snapshot: z.nullable(snapshot) }),
  z.object({
    kind: z.literal('failed'),
    reason: runFailureReason,
    detail: z.string(),
    snapshot: z.nullable(snapshot),
  }),
]);

const runRecord = z.object({
  format: z.literal(RECORD_FORMAT),
  id: id(RunId),
  taskId: id(TaskId),
  kind: z.enum(['start', 'resume', 'replay']),
  image: text,
  model: text,
  startedAt: instant,
  state: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('started') }),
    z.object({ kind: z.literal('finished'), outcome, applied: z.boolean(), at: instant }),
    z.object({ kind: z.literal('interrupted'), at: instant }),
    z.object({ kind: z.literal('aborted'), at: instant }),
  ]),
});

/** A stored record that does not read as its format: storage is corrupt, never silently fixed. */
export class CorruptRecord extends Error {
  constructor(what: string, id: string, cause: unknown) {
    super(`Stored ${what} ${id} is not readable: ${String(cause)}`);
  }
}

/** The stored record of a task: every field named, so nothing reaches storage by accident. */
export const taskToRecord = (task: Task): unknown => ({
  format: RECORD_FORMAT,
  id: task.id,
  requester: task.requester,
  projectId: task.projectId,
  bundle: task.bundle,
  credentials: task.credentials,
  baseSha: task.baseSha,
  state: task.state,
  exchanges: task.exchanges,
  runAttempts: task.runAttempts,
  publishAttempts: task.publishAttempts,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

export const taskFromRecord = (record: unknown, version: number, id: string): Task => {
  const parsed = taskRecord.safeParse(record);
  if (!parsed.success) throw new CorruptRecord('task', id, parsed.error);
  const stored = parsed.data;
  return {
    id: stored.id,
    requester: stored.requester,
    projectId: stored.projectId,
    bundle: stored.bundle,
    credentials: stored.credentials,
    baseSha: stored.baseSha,
    state: stored.state,
    exchanges: stored.exchanges,
    runAttempts: stored.runAttempts,
    publishAttempts: stored.publishAttempts,
    version,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
};

export const runToRecord = (run: Run): unknown => ({
  format: RECORD_FORMAT,
  id: run.id,
  taskId: run.taskId,
  kind: run.kind,
  image: run.image,
  model: run.model,
  startedAt: run.startedAt,
  state: run.state,
});

export const runFromRecord = (record: unknown, id: string): Run => {
  const parsed = runRecord.safeParse(record);
  if (!parsed.success) throw new CorruptRecord('run', id, parsed.error);
  const stored = parsed.data;
  return {
    id: stored.id,
    taskId: stored.taskId,
    kind: stored.kind,
    image: stored.image,
    model: stored.model,
    startedAt: stored.startedAt,
    state: stored.state,
  };
};

const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('submitted'), at: instant }),
  z.object({ type: z.literal('run-started'), at: instant, runId: id(RunId), resumed: z.boolean() }),
  z.object({ type: z.literal('base-fixed'), at: instant, runId: id(RunId), baseSha: text }),
  z.object({ type: z.literal('question-asked'), at: instant, questionId: id(QuestionId) }),
  z.object({
    type: z.literal('answered'),
    at: instant,
    questionId: id(QuestionId),
    source: z.enum(['requester', 'timeout']),
  }),
  z.object({ type: z.literal('change-proposed'), at: instant, runId: id(RunId) }),
  z.object({
    type: z.literal('requeued'),
    at: instant,
    runId: id(RunId),
    reason: z.enum(['infra', 'quota', 'credential']),
    detail: z.string(),
  }),
  z.object({
    type: z.literal('publish-deferred'),
    at: instant,
    attempt: z.int(),
    detail: z.string(),
  }),
  z.object({ type: z.literal('published'), at: instant, url: text }),
  z.object({ type: z.literal('opened-after-cancel'), at: instant, url: text }),
  z.object({ type: z.literal('awaiting-credential'), at: instant }),
  z.object({ type: z.literal('credential-arrived'), at: instant }),
  z.object({ type: z.literal('failed'), at: instant, code: failureCode }),
  z.object({ type: z.literal('cancelled'), at: instant, reason: z.string() }),
]);

export const eventFromRecord = (record: unknown, taskId: string): TaskEvent => {
  const parsed = event.safeParse(record);
  if (!parsed.success) throw new CorruptRecord('event of task', taskId, parsed.error);
  return parsed.data;
};

const grantTermsRecord = z.discriminatedUnion('phase', [
  z.object({
    format: z.literal(RECORD_FORMAT),
    phase: z.literal('setup'),
    runId: id(RunId),
    taskId: id(TaskId),
    hosts: z.array(text),
  }),
  z.object({
    format: z.literal(RECORD_FORMAT),
    phase: z.literal('agent'),
    runId: id(RunId),
    taskId: id(TaskId),
    model: text,
    credentials: z.enum(['requester', 'operator']),
    budget: z.object({ usd: z.number(), tokens: z.number() }),
  }),
]);

export const grantTermsToRecord = (terms: GrantTerms): unknown => ({
  format: RECORD_FORMAT,
  ...terms,
});

export const grantTermsFromRecord = (record: unknown, runId: string): GrantTerms => {
  const parsed = grantTermsRecord.safeParse(record);
  if (!parsed.success) throw new CorruptRecord('grant', runId, parsed.error);
  const stored = parsed.data;
  return stored.phase === 'setup'
    ? { phase: 'setup', runId: stored.runId, taskId: stored.taskId, hosts: stored.hosts }
    : {
        phase: 'agent',
        runId: stored.runId,
        taskId: stored.taskId,
        model: stored.model,
        credentials: stored.credentials,
        budget: { usd: stored.budget.usd, tokens: stored.budget.tokens },
      };
};

const refusalRecord = z.object({
  format: z.literal(RECORD_FORMAT),
  refusal: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('grant-revoked') }),
    z.object({ kind: z.literal('budget-exhausted') }),
    z.object({ kind: z.literal('credential-missing') }),
    z.object({ kind: z.literal('credential-refused') }),
    z.object({ kind: z.literal('quota-exhausted'), resetAt: instant }),
    z.object({ kind: z.literal('request-refused'), detail: z.string() }),
  ]),
});

export const refusalToRecord = (refusal: GatewayRefusal): unknown => ({
  format: RECORD_FORMAT,
  refusal,
});

export const refusalFromRecord = (record: unknown, runId: string): GatewayRefusal => {
  const parsed = refusalRecord.safeParse(record);
  if (!parsed.success) throw new CorruptRecord('refusal', runId, parsed.error);
  return parsed.data.refusal;
};
