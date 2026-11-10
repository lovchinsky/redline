import { parse as parseYaml } from 'yaml';
import * as z from 'zod/mini';
import { DEFAULT_CHANGE_POLICY, type ChangePolicyRules } from '../../domain/change-policy';
import { isEgressRule } from '../../domain/egress';
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
import type { HostedRepository, RepositoryRegistry } from '../../ports/source';

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
  setupHosts: z.optional(
    z.array(
      z
        .string()
        .check(z.refine(isEgressRule, 'a host name, or *. and a domain of two labels or more')),
    ),
  ),
  setupSecrets: z.optional(
    z.record(z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 'a file name')), text),
  ),
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

/**
 * A project: with `git: local` or `scripted`, one the receiver serves; with `git: github`, how
 * the repository of that name differs from `defaults` (its id and name are the repository's).
 */
const publishing = z.object({
  target: z.optional(z.enum(['fork', 'branch'])),
  draft: z.optional(z.boolean()),
});

const project = z.object({
  id: z.optional(
    z.string().check(z.regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes')),
  ),
  name: z.optional(text),
  /** With `git: github`: the repository is not offered, though the host gives it. */
  hidden: z.optional(z.boolean()),
  access: z.optional(z.union([z.literal('everyone'), z.object({ users: z.array(text) })])),
  repository: z.object({ host: z.optional(text), name: text, baseBranch: z.optional(text) }),
  publishing: z.optional(publishing),
  policy: z.optional(policy),
  execution: z.optional(execution),
  changePolicy: z.optional(changePolicy),
});

const sandboxAddress = z.url({ protocol: /^http$/ });

/**
 * The agent: `scripted` follows a script (no model, no sandbox, for trying the receiver out);
 * `claude` is Claude Code in Docker sandboxes, isolated by gVisor unless that is waived by name.
 */
const agent = z.union([
  z.object({
    kind: z.literal('scripted'),
    durationSeconds: z.optional(z.number().check(z.nonnegative())),
    asks: z.optional(z.boolean()),
  }),
  z.object({
    /** The agent when none is named. */
    kind: z.optional(z.literal('claude')),
    /** `auto`: gVisor where Docker has it, runc (warned of) where it has not. */
    isolation: z.optional(z.enum(['gvisor', 'unsafe-runc', 'auto'])),
    docker: z.optional(z.object({ socket: z.optional(text) })),
    user: z.optional(z.object({ uid: positive, gid: positive })),
    /** The sandbox networks; the compose files' own by default. */
    networks: z.optional(z.object({ setup: text, agent: text })),
    /** The gateway's addresses on the sandbox networks: sandboxes resolve no names. */
    gateway: z.optional(z.object({ model: sandboxAddress, egress: sandboxAddress })),
    limits: z.optional(
      z.object({
        cpus: z.optional(z.number().check(z.positive())),
        memoryMegabytes: z.optional(positive),
        pids: z.optional(positive),
      }),
    ),
    setupTimeoutMinutes: z.optional(positive),
  }),
]);

/**
 * The git host: `scripted` simulates one; `local` works on repositories by path under `root`
 * (`repository.host: local`), pushes a change there as its branch and simulates the change
 * request.
 */
const git = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scripted'),
    resultBaseUrl: z.optional(z.url({ protocol: /^https?$/ })),
  }),
  z.object({
    kind: z.literal('local'),
    root: text,
    resultBaseUrl: z.optional(z.url({ protocol: /^https?$/ })),
  }),
  z.object({
    kind: z.literal('github'),
    /** The REST API: GitHub's, or a GitHub Enterprise Server's `https://host/api/v3`. */
    api: z.optional(z.url({ protocol: /^https$/ })),
    /** Where git reaches repositories. */
    web: z.optional(z.url({ protocol: /^https$/ })),
    auth: z.union([
      z.object({ app: z.object({ id: z.union([text, positive]), privateKeyFile: text }) }),
      z.object({ token: z.object({ file: text }) }),
    ]),
    /** The owner of the bot's forks, for projects that publish to a fork. */
    fork: z.optional(z.object({ owner: text })),
    /** The receiver as commits name it: every task's co-author, beside its requester. */
    commitAs: z.optional(z.object({ name: text, email: text })),
    gitleaks: z.optional(text),
  }),
]);

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
  /** Claude Code in sandboxes, as the compose files set them up, by default. */
  agent: z.optional(agent),
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
      publishing: z.optional(publishing),
    }),
  ),
  /** The projects (`git: local`, `scripted`), or how some repositories differ (`git: github`). */
  projects: z.optional(z.array(project)),
});

type RawPolicy = z.infer<typeof policy>;
type RawAgent = z.infer<typeof agent>;

const SCRIPTED_RESULTS = 'https://git.example/redline/scripted/pull/';

type RawGit = z.infer<typeof git>;

const gitOf = (raw: RawGit): GitConfig => {
  switch (raw.kind) {
    case 'scripted':
      return { kind: 'scripted', resultBaseUrl: raw.resultBaseUrl ?? SCRIPTED_RESULTS };
    case 'local':
      return {
        kind: 'local',
        root: raw.root,
        resultBaseUrl: raw.resultBaseUrl ?? SCRIPTED_RESULTS,
      };
    case 'github':
      return {
        kind: 'github',
        api: raw.api ?? 'https://api.github.com',
        web: raw.web ?? 'https://github.com',
        auth:
          'app' in raw.auth
            ? {
                kind: 'app',
                appId: String(raw.auth.app.id),
                privateKeyFile: raw.auth.app.privateKeyFile,
              }
            : { kind: 'token', file: raw.auth.token.file },
        forkOwner: raw.fork?.owner ?? null,
        commitAs: raw.commitAs ?? { name: 'Redline', email: 'redline@users.noreply.github.com' },
        gitleaks: raw.gitleaks ?? 'gitleaks',
      };
  }
};

/** The sandbox networks the compose files create, and the gateway's addresses on them. */
const SANDBOX_NETWORKS = { setup: 'redline-sandbox-setup', agent: 'redline-sandbox-agent' };
const SANDBOX_GATEWAY = { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' };

const agentOf = (raw: RawAgent | undefined): AgentConfig =>
  raw === undefined
    ? agentOf({ kind: 'claude' })
    : raw.kind === 'scripted'
      ? { kind: 'scripted', durationMs: (raw.durationSeconds ?? 5) * 1000, asks: raw.asks ?? true }
      : {
          kind: 'claude',
          runtime:
            raw.isolation === 'unsafe-runc' ? 'runc' : raw.isolation === 'auto' ? 'auto' : 'runsc',
          dockerSocket: raw.docker?.socket ?? '/var/run/docker.sock',
          user: raw.user ?? { uid: 1000, gid: 1000 },
          networks: raw.networks ?? SANDBOX_NETWORKS,
          gateway: raw.gateway ?? SANDBOX_GATEWAY,
          limits: {
            cpus: raw.limits?.cpus ?? 2,
            memoryBytes: (raw.limits?.memoryMegabytes ?? 4096) * 1024 * 1024,
            pids: raw.limits?.pids ?? 1024,
          },
          setupTimeoutMs: (raw.setupTimeoutMinutes ?? 15) * MINUTE,
        };
type RawExecution = z.infer<typeof execution>;
type RawProject = z.infer<typeof project>;
type RawChangePolicy = z.infer<typeof changePolicy>;

export interface IntakeLimits {
  readonly bundleBytes: number;
  readonly files: number;
  readonly submissionsPerMinute: number;
}

export type AgentConfig =
  | { readonly kind: 'scripted'; readonly durationMs: number; readonly asks: boolean }
  | {
      readonly kind: 'claude';
      /** The OCI runtime sandboxes run under; `auto` decides on Docker's (`DockerSandboxes`). */
      readonly runtime: 'runsc' | 'runc' | 'auto';
      readonly dockerSocket: string;
      readonly user: { readonly uid: number; readonly gid: number };
      readonly networks: { readonly setup: string; readonly agent: string };
      readonly gateway: { readonly model: string; readonly egress: string };
      readonly limits: {
        readonly cpus: number;
        readonly memoryBytes: number;
        readonly pids: number;
      };
      readonly setupTimeoutMs: number;
    };

export type GitConfig =
  | { readonly kind: 'scripted'; readonly resultBaseUrl: string }
  | { readonly kind: 'local'; readonly root: string; readonly resultBaseUrl: string }
  | {
      readonly kind: 'github';
      readonly api: string;
      readonly web: string;
      readonly auth:
        | { readonly kind: 'app'; readonly appId: string; readonly privateKeyFile: string }
        | { readonly kind: 'token'; readonly file: string };
      readonly forkOwner: string | null;
      readonly commitAs: { readonly name: string; readonly email: string };
      readonly gitleaks: string;
    };

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
  readonly agent: AgentConfig;
  readonly git: GitConfig;
  readonly modelAccess: ModelAccessPolicy;
  readonly gateway: GatewayConfig;
  readonly intake: IntakeLimits;
  readonly worker: { readonly runSlots: number; readonly runsPerProject: number };
  readonly projects: ProjectSource;
  /** The longest any project's run may take. */
  readonly longestRunMs: number;
}

/**
 * Where the receiver's projects come from: listed in the configuration, or the repositories the
 * git host gives it, each shaped by `projectOf` (null: not offered).
 */
export type ProjectSource =
  | { readonly kind: 'listed'; readonly projects: readonly Project[] }
  | {
      readonly kind: 'hosted';
      readonly projectOf: (repository: HostedRepository) => Project | null;
      /** The repositories the configuration says something about. */
      readonly named: readonly string[];
    };

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
    setupSecrets: merged.setupSecrets ?? {},
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
  if (raw.models.credentials !== 'required' && raw.models.operator === undefined) {
    errors.push(
      `models.operator: tasks run with the operator's credential (credentials: ${raw.models.credentials}); say where it is`,
    );
  }
  const prices = { ...LIST_PRICES, ...(raw.models.prices ?? {}) };
  const hosted = raw.git.kind === 'github';
  const forkOwner = raw.git.kind === 'github' ? raw.git.fork : undefined;

  /** A project from its entry (or none: the defaults alone), its problems reported as `where`. */
  const projectFrom = (
    entry: RawProject | null,
    repository: { readonly host: string; readonly name: string; readonly baseBranch: string },
    identity: { readonly id: string; readonly name: string },
    where: string,
  ): Project | null => {
    const rules = changePolicyOf(defaults.changePolicy ?? {}, entry?.changePolicy ?? {});
    if (!rules.ok) {
      errors.push(...rules.errors.map((error) => `${where}.changePolicy: ${error}`));
      return null;
    }
    const execution = executionOf(defaults.execution ?? {}, entry?.execution ?? {});
    if (prices[execution.model] === undefined) {
      errors.push(`${where}.execution.model: no price for ${execution.model}; set models.prices`);
    }
    const target = entry?.publishing?.target ?? defaults.publishing?.target ?? 'branch';
    if (hosted && target === 'fork' && forkOwner === undefined) {
      errors.push(`${where}.publishing: it publishes to a fork; set git.fork.owner`);
    }
    return {
      id: ProjectId(identity.id),
      name: identity.name,
      access:
        entry?.access === undefined || entry.access === 'everyone'
          ? { kind: 'everyone' }
          : { kind: 'users', users: entry.access.users.map(UserId) },
      repository,
      policy: policyOf(defaults.policy ?? {}, entry?.policy ?? {}),
      changePolicy: rules.value,
      execution,
      publishing: {
        target,
        draft: entry?.publishing?.draft ?? defaults.publishing?.draft ?? true,
      },
    };
  };

  let projects: ProjectSource;
  const entries = raw.projects ?? [];
  const timeouts = [executionOf(defaults.execution ?? {}, {}).timeoutMs];
  if (hosted) {
    const byName = new Map<string, RawProject>();
    entries.forEach((entry, index) => {
      const where = `projects[${String(index)}]`;
      const name = entry.repository.name;
      if (entry.id !== undefined) {
        errors.push(`${where}.id: with git: github a project is its repository; drop the id`);
      }
      if (
        (entry.repository.host !== undefined && entry.repository.host !== 'github') ||
        !/^[\w.-]+\/[\w.-]+$/.test(name)
      ) {
        errors.push(
          `${where}.repository: git is github, so its host is github and its name owner/repo`,
        );
      }
      if (byName.has(name.toLowerCase())) errors.push(`${where}: ${name} is configured twice`);
      byName.set(name.toLowerCase(), entry);
      // Checked now, so that a repository the host gives later cannot fail on its rules.
      const checked = projectFrom(
        entry,
        { host: 'github', name, baseBranch: entry.repository.baseBranch ?? 'main' },
        { id: name, name },
        where,
      );
      if (checked !== null) timeouts.push(checked.execution.timeoutMs);
    });
    // The defaults alone, checked now for the repositories no entry names.
    projectFrom(
      null,
      { host: 'github', name: 'owner/repo', baseBranch: 'main' },
      { id: 'x', name: 'x' },
      'defaults',
    );
    projects = {
      kind: 'hosted',
      named: [...byName.values()].map((entry) => entry.repository.name),
      projectOf: (repository) => {
        const entry = byName.get(repository.name.toLowerCase()) ?? null;
        if (entry?.hidden === true) return null;
        return projectFrom(
          entry,
          {
            host: 'github',
            name: repository.name,
            baseBranch: entry?.repository.baseBranch ?? repository.baseBranch,
          },
          { id: repository.name, name: entry?.name ?? repository.name },
          repository.name,
        );
      },
    };
  } else {
    if (entries.length === 0) {
      errors.push(`projects: git is ${raw.git.kind}, so the projects are listed here; list one`);
    }
    const listed: Project[] = [];
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const id = entry.id ?? '';
      const where = `projects.${id === '' ? `[${String(index)}]` : id}`;
      if (entry.id === undefined || entry.name === undefined) {
        errors.push(`${where}: a listed project has an id and a name`);
        return;
      }
      if (seen.has(id)) errors.push(`projects: ${id} is configured twice`);
      seen.add(id);
      const repository = {
        host: entry.repository.host ?? raw.git.kind,
        name: entry.repository.name,
        baseBranch: entry.repository.baseBranch ?? 'main',
      };
      if (
        raw.git.kind === 'local' &&
        (repository.host !== 'local' || repository.name.split('/').includes('..'))
      ) {
        errors.push(
          `${where}.repository: git is local, so its host is local and its name a path under ${raw.git.root}`,
        );
      }
      const made = projectFrom(entry, repository, { id, name: entry.name }, where);
      if (made !== null) {
        listed.push(made);
        timeouts.push(made.execution.timeoutMs);
      }
    });
    projects = { kind: 'listed', projects: listed };
  }
  if (raw.agent?.kind !== 'scripted' && raw.git.kind === 'scripted') {
    errors.push('git: the claude agent works on real repositories; the scripted git host has none');
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
      agent: agentOf(raw.agent),
      git: gitOf(raw.git),
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
      longestRunMs: Math.max(...timeouts),
    },
  };
};

/** The projects listed in the configuration, as the use cases see them. */
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

/**
 * The repositories the worker last found on the git host (`RepositoryRegistry`), each a project
 * shaped by the configuration. They are read again with `refresh`; until then, and when it
 * fails, the projects stay as they were read last.
 */
export class HostedProjects implements ProjectCatalog {
  private projects: readonly Project[] = [];
  private byId: ReadonlyMap<ProjectId, Project> = new Map();

  constructor(
    private readonly source: Extract<ProjectSource, { kind: 'hosted' }>,
    private readonly registry: RepositoryRegistry,
  ) {}

  async refresh(): Promise<void> {
    const repositories = await this.registry.list();
    this.projects = repositories
      .map((repository) => this.source.projectOf(repository))
      .filter((project) => project !== null);
    this.byId = new Map(this.projects.map((entry) => [entry.id, entry]));
  }

  list(): readonly Project[] {
    return this.projects;
  }

  get(id: ProjectId): Project | null {
    return this.byId.get(id) ?? null;
  }
}
