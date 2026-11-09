import { parse as parseYaml } from 'yaml';
import * as z from 'zod/mini';
import { DEFAULT_CHANGE_POLICY, type ChangePolicyRules } from '../../domain/change-policy';
import { ProjectId, UserId } from '../../domain/ids';
import type { TaskPolicy } from '../../domain/policy';
import type { CredentialKind } from '../../domain/grant';
import type { ModelPrice } from '../../domain/usage';
import type {
  ExecutionProfile,
  ModelAccessPolicy,
  Project,
  ProjectCatalog,
} from '../../ports/access';

const text = z.string().check(z.minLength(1));
const count = z.int().check(z.nonnegative());
const positive = z.int().check(z.positive());

const policy = z.object({
  maxQuestions: z.optional(count),
  maxRunAttempts: z.optional(positive),
  maxPublishAttempts: z.optional(positive),
  replyTimeoutHours: z.optional(z.number().check(z.positive())),
  onReplyTimeout: z.optional(z.enum(['proceed', 'fail'])),
});

const execution = z.object({
  image: z.optional(text),
  model: z.optional(text),
  maxTurns: z.optional(positive),
  timeoutMinutes: z.optional(positive),
  stallMinutes: z.optional(positive),
  budgetUsd: z.optional(z.number().check(z.positive())),
  budgetTokens: z.optional(positive),
  setupHosts: z.optional(z.array(text)),
});

const changePolicy = z.object({
  /** Paths protected in addition to the defaults. */
  deny: z.optional(z.array(text)),
  /** Default protections lifted for this project, named exactly. */
  exempt: z.optional(z.array(text)),
  flag: z.optional(z.array(text)),
  maxFiles: z.optional(positive),
  maxChangedLines: z.optional(positive),
  maxBinaryKilobytes: z.optional(positive),
});

const project = z.object({
  id: z
    .string()
    .check(z.regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes')),
  name: text,
  access: z.optional(z.union([z.literal('everyone'), z.object({ users: z.array(text) })])),
  repository: z.object({ host: text, name: text, baseBranch: z.optional(text) }),
  publishing: z.optional(
    z.object({ target: z.optional(z.enum(['fork', 'branch'])), draft: z.optional(z.boolean()) }),
  ),
  policy: z.optional(policy),
  execution: z.optional(execution),
  changePolicy: z.optional(changePolicy),
});

/** The agent: a scripted one (no model, no sandbox) until the sandboxed runner is configured. */
const agent = z.object({
  kind: z.literal('scripted'),
  durationSeconds: z.optional(z.number().check(z.nonnegative())),
  asks: z.optional(z.boolean()),
});

/** Where changes are published: a simulated git host until a real one is configured. */
const git = z.object({
  kind: z.literal('scripted'),
  resultBaseUrl: z.optional(z.url({ protocol: /^https?$/ })),
});

const seconds = z.int().check(z.positive());
const dollars = z.number().check(z.nonnegative());
const price = z.object({
  input: dollars,
  output: dollars,
  cacheWrite: dollars,
  cacheRead: dollars,
});

/**
 * List prices of the models a run may use, in dollars per million tokens. They turn usage into
 * the dollars of a task's budget; an operator whose contract differs sets `models.prices`.
 */
export const LIST_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

const configSchema = z.object({
  agent,
  /** How soon the extension asks again about a task, by what the task is doing. */
  polling: z.optional(
    z.object({
      queuedSeconds: z.optional(seconds),
      workingSeconds: z.optional(seconds),
      waitingSeconds: z.optional(seconds),
      finishedSeconds: z.optional(seconds),
    }),
  ),
  git,
  models: z.object({
    credentials: z.enum(['managed', 'required', 'optional']),
    /** The operator's own credential, read by the gateway from a secret file. */
    operator: z.optional(z.object({ kind: z.enum(['api-key', 'subscription']), secretFile: text })),
    acceptRequesterSubscriptions: z.optional(z.boolean()),
    /** Prices of models in dollars per million tokens, over the list prices built in. */
    prices: z.optional(z.record(text, price)),
  }),
  /** Where the gateway sends model requests, and how large one may be. */
  gateway: z.optional(
    z.object({
      upstream: z.optional(z.url({ protocol: /^https?$/ })),
      maxTokens: z.optional(positive),
    }),
  ),
  intake: z.optional(
    z.object({
      bundleMegabytes: z.optional(positive),
      files: z.optional(positive),
      submissionsPerMinute: z.optional(positive),
    }),
  ),
  worker: z.optional(
    z.object({ runSlots: z.optional(positive), runsPerProject: z.optional(positive) }),
  ),
  defaults: z.optional(
    z.object({
      policy: z.optional(policy),
      execution: z.optional(execution),
      changePolicy: z.optional(changePolicy),
    }),
  ),
  projects: z.array(project).check(z.minLength(1)),
});

type RawPolicy = z.infer<typeof policy>;
type RawExecution = z.infer<typeof execution>;
type RawChangePolicy = z.infer<typeof changePolicy>;

export interface IntakeLimits {
  readonly bundleBytes: number;
  readonly files: number;
  readonly submissionsPerMinute: number;
}

export interface GatewayConfig {
  readonly upstream: string;
  readonly maxTokens: number;
  readonly prices: Readonly<Record<string, ModelPrice>>;
  /** Where the operator's credential is; null when tasks run with requesters' only. */
  readonly operator: { readonly kind: CredentialKind; readonly secretFile: string } | null;
}

export interface ReceiverConfig {
  readonly polling: {
    readonly queued: number;
    readonly working: number;
    readonly waiting: number;
    readonly finished: number;
  };
  readonly agent: {
    readonly kind: 'scripted';
    readonly durationMs: number;
    readonly asks: boolean;
  };
  readonly git: { readonly kind: 'scripted'; readonly resultBaseUrl: string };
  readonly modelAccess: ModelAccessPolicy;
  readonly gateway: GatewayConfig;
  readonly intake: IntakeLimits;
  readonly worker: { readonly runSlots: number; readonly runsPerProject: number };
  readonly projects: readonly Project[];
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

const policyOf = (base: RawPolicy, own: RawPolicy): TaskPolicy => {
  const merged = { ...base, ...own };
  return {
    maxQuestions: merged.maxQuestions ?? 3,
    maxRunAttempts: merged.maxRunAttempts ?? 3,
    maxPublishAttempts: merged.maxPublishAttempts ?? 5,
    replyTimeoutMs: (merged.replyTimeoutHours ?? 168) * HOUR,
    onReplyTimeout: merged.onReplyTimeout ?? 'proceed',
    retryBaseMs: 30_000,
    retryMaxMs: 15 * MINUTE,
  };
};

const executionOf = (base: RawExecution, own: RawExecution): ExecutionProfile => {
  const merged = { ...base, ...own };
  return {
    image: merged.image ?? 'redline-agent:latest',
    model: merged.model ?? 'claude-opus-5-5',
    maxTurns: merged.maxTurns ?? 200,
    timeoutMs: (merged.timeoutMinutes ?? 45) * MINUTE,
    stallTimeoutMs: (merged.stallMinutes ?? 10) * MINUTE,
    budget: { usd: merged.budgetUsd ?? 10, tokens: merged.budgetTokens ?? 10_000_000 },
    setupHosts: merged.setupHosts ?? ['registry.npmjs.org'],
  };
};

const changePolicyOf = (base: RawChangePolicy, own: RawChangePolicy): Result<ChangePolicyRules> => {
  const exempt = [...(base.exempt ?? []), ...(own.exempt ?? [])];
  const unknown = exempt.filter((pattern) => !DEFAULT_CHANGE_POLICY.deny.includes(pattern));
  if (unknown.length > 0)
    return { ok: false, errors: [`exempt names no default protection: ${unknown.join(', ')}`] };
  const unique = (patterns: readonly string[]) => [...new Set(patterns)];
  return {
    ok: true,
    value: {
      deny: unique([
        ...DEFAULT_CHANGE_POLICY.deny.filter((pattern) => !exempt.includes(pattern)),
        ...(base.deny ?? []),
        ...(own.deny ?? []),
      ]),
      flag: unique([...DEFAULT_CHANGE_POLICY.flag, ...(base.flag ?? []), ...(own.flag ?? [])]),
      maxFiles: own.maxFiles ?? base.maxFiles ?? DEFAULT_CHANGE_POLICY.maxFiles,
      maxChangedLines:
        own.maxChangedLines ?? base.maxChangedLines ?? DEFAULT_CHANGE_POLICY.maxChangedLines,
      maxBinaryBytes:
        (own.maxBinaryKilobytes ??
          base.maxBinaryKilobytes ??
          DEFAULT_CHANGE_POLICY.maxBinaryBytes / 1024) * 1024,
    },
  };
};

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Reads the operator's configuration (YAML); every problem is reported, with where it is. */
export const parseConfig = (source: string): Result<ReceiverConfig> => {
  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    return {
      ok: false,
      errors: [`not YAML: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const parsed = configSchema.safeParse(document);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  const raw = parsed.data;
  const defaults = raw.defaults ?? {};
  const errors: string[] = [];
  const projects: Project[] = [];
  const seen = new Set<string>();
  for (const entry of raw.projects) {
    if (seen.has(entry.id)) errors.push(`projects: ${entry.id} is configured twice`);
    seen.add(entry.id);
    const rules = changePolicyOf(defaults.changePolicy ?? {}, entry.changePolicy ?? {});
    if (!rules.ok) {
      errors.push(...rules.errors.map((error) => `projects.${entry.id}.changePolicy: ${error}`));
      continue;
    }
    projects.push({
      id: ProjectId(entry.id),
      name: entry.name,
      access:
        entry.access === undefined || entry.access === 'everyone'
          ? { kind: 'everyone' }
          : { kind: 'users', users: entry.access.users.map(UserId) },
      repository: {
        host: entry.repository.host,
        name: entry.repository.name,
        baseBranch: entry.repository.baseBranch ?? 'main',
      },
      policy: policyOf(defaults.policy ?? {}, entry.policy ?? {}),
      changePolicy: rules.value,
      execution: executionOf(defaults.execution ?? {}, entry.execution ?? {}),
      publishing: {
        target: entry.publishing?.target ?? 'fork',
        draft: entry.publishing?.draft ?? true,
      },
    });
  }
  if (raw.models.credentials !== 'required' && raw.models.operator === undefined) {
    errors.push(
      `models.operator: tasks run with the operator's credential (credentials: ${raw.models.credentials}); say where it is`,
    );
  }
  const prices = { ...LIST_PRICES, ...(raw.models.prices ?? {}) };
  for (const entry of projects) {
    if (prices[entry.execution.model] === undefined) {
      errors.push(
        `projects.${entry.id}.execution.model: no price for ${entry.execution.model}; set models.prices`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      polling: {
        queued: raw.polling?.queuedSeconds ?? 30,
        working: raw.polling?.workingSeconds ?? 60,
        waiting: raw.polling?.waitingSeconds ?? 60,
        finished: raw.polling?.finishedSeconds ?? 3600,
      },
      agent: {
        kind: raw.agent.kind,
        durationMs: (raw.agent.durationSeconds ?? 5) * 1000,
        asks: raw.agent.asks ?? true,
      },
      git: {
        kind: raw.git.kind,
        resultBaseUrl: raw.git.resultBaseUrl ?? 'https://git.example/redline/scripted/pull/',
      },
      modelAccess: {
        credentials: raw.models.credentials,
        operator: raw.models.operator?.kind ?? null,
        acceptRequesterSubscriptions: raw.models.acceptRequesterSubscriptions ?? false,
      },
      gateway: {
        upstream: raw.gateway?.upstream ?? 'https://api.anthropic.com',
        maxTokens: raw.gateway?.maxTokens ?? 128_000,
        prices,
        operator: raw.models.operator ?? null,
      },
      intake: {
        bundleBytes: (raw.intake?.bundleMegabytes ?? 50) * 1024 * 1024,
        files: raw.intake?.files ?? 500,
        submissionsPerMinute: raw.intake?.submissionsPerMinute ?? 30,
      },
      worker: {
        runSlots: raw.worker?.runSlots ?? 2,
        runsPerProject: raw.worker?.runsPerProject ?? 1,
      },
      projects,
    },
  };
};

/** The projects of a configuration, as the use cases see them. */
export class ConfiguredProjects implements ProjectCatalog {
  private readonly byId: ReadonlyMap<ProjectId, Project>;

  constructor(private readonly projects: readonly Project[]) {
    this.byId = new Map(projects.map((entry) => [entry.id, entry]));
  }

  list(): readonly Project[] {
    return this.projects;
  }

  get(id: ProjectId): Project | null {
    return this.byId.get(id) ?? null;
  }
}
