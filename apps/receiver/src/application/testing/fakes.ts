import {
  DEFAULT_CHANGE_POLICY,
  type ChangeDescription,
  type SecretFinding,
} from '../../domain/change-policy';
import {
  ProjectId,
  RunId,
  TaskId,
  UserId,
  type BlobDigest,
  type Instant,
  type QuestionId as QuestionIdType,
  type TaskId as TaskIdType,
  type UserId as UserIdType,
} from '../../domain/ids';
import type { Budget, GatewayRefusal, GrantTerms } from '../../domain/grant';
import type { TokenUsage } from '../../domain/usage';
import type { Run, RunOutcome } from '../../domain/run';
import type { Task, TaskEvent } from '../../domain/task';
import type { ChangeRequestRef } from '../../domain/work';
import {
  ModelCredential,
  type CredentialVault,
  type Identity,
  type ModelAccessPolicy,
  type Project,
  type ProjectCatalog,
  type User,
} from '../../ports/access';
import type { AgentRunner, RunPhases, RunSpec, RunnerError } from '../../ports/agent';
import type { BundleContents, BundleReader } from '../../ports/bundles';
import type {
  ChangeRequestDraft,
  DeterministicCommit,
  Forge,
  PublishError,
  Publishing,
  SecretScanner,
  SourceRepository,
} from '../../ports/publishing';
import type { GrantBook, MeteredRequest, UsageLedger } from '../../ports/gateway';
import type { Clock, IdGenerator, Logger } from '../../ports/system';
import type {
  GrantToken,
  InsertResult,
  Job,
  TaskQueries,
  UnitOfWork,
  WorkScope,
} from '../../ports/tasks';

/** Stored state: what a database would hold. */
interface State {
  tasks: Map<TaskIdType, Task>;
  keys: Map<string, TaskIdType>;
  runs: Map<string, Run>;
  history: { taskId: TaskIdType; event: TaskEvent }[];
  jobs: { job: Job; startAfter: Instant | null }[];
  /** Grants in force, by run. */
  grants: Map<string, GrantTerms[]>;
  /** Every grant ever issued, in order, revoked or not. */
  issued: GrantTerms[];
  /** The gateway's last refusal of each run. */
  refusals: Map<string, GatewayRefusal>;
}

const copy = (state: State): State => ({
  tasks: new Map(state.tasks),
  keys: new Map(state.keys),
  runs: new Map(state.runs),
  history: [...state.history],
  jobs: [...state.jobs],
  grants: new Map(state.grants),
  issued: [...state.issued],
  refusals: new Map(state.refusals),
});

const submissionKey = (requester: UserIdType, key: string) => `${requester}\u0000${key}`;

/**
 * A transactional in-memory store: each unit of work runs on a copy that replaces the store when
 * it resolves and is dropped when it throws. Units of work run one at a time.
 */
export class MemoryStore implements UnitOfWork, TaskQueries {
  state: State = {
    tasks: new Map(),
    keys: new Map(),
    runs: new Map(),
    history: [],
    jobs: [],
    grants: new Map(),
    issued: [],
    refusals: new Map(),
  };
  private queue: Promise<unknown> = Promise.resolve();
  /** The next this many task saves find the task changed by someone else, as under concurrency. */
  concurrentWrites = 0;

  run<T>(work: (scope: WorkScope) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const draft = copy(this.state);
      const result = await work(this.scope(draft));
      this.state = draft;
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private scope(draft: State): WorkScope {
    return {
      tasks: {
        get: (id) => Promise.resolve(draft.tasks.get(id) ?? null),
        findBySubmission: (requester, key) => {
          const id = draft.keys.get(submissionKey(requester, key));
          return Promise.resolve(id === undefined ? null : (draft.tasks.get(id) ?? null));
        },
        insert: (task, key): Promise<InsertResult> => {
          const existing = draft.keys.get(submissionKey(task.requester, key));
          const found = existing === undefined ? undefined : draft.tasks.get(existing);
          if (found !== undefined) return Promise.resolve({ inserted: false, existing: found });
          const stored = { ...task, version: 1 };
          draft.tasks.set(task.id, stored);
          draft.keys.set(submissionKey(task.requester, key), task.id);
          return Promise.resolve({ inserted: true, task: stored });
        },
        save: (task) => {
          if (this.concurrentWrites > 0) {
            this.concurrentWrites -= 1;
            return Promise.resolve(null);
          }
          const stored = draft.tasks.get(task.id);
          if (stored?.version !== task.version) return Promise.resolve(null);
          const saved = { ...task, version: task.version + 1 };
          draft.tasks.set(task.id, saved);
          return Promise.resolve(saved);
        },
      },
      runs: {
        get: (id) => Promise.resolve(draft.runs.get(id) ?? null),
        insert: (run) => {
          draft.runs.set(run.id, run);
          return Promise.resolve();
        },
        save: (run) => {
          draft.runs.set(run.id, run);
          return Promise.resolve();
        },
      },
      history: {
        append: (taskId, event) => {
          draft.history.push({ taskId, event });
          return Promise.resolve();
        },
      },
      jobs: {
        schedule: (job, startAfter) => {
          draft.jobs.push({ job, startAfter });
          return Promise.resolve();
        },
      },
      grants: {
        issue: (terms) => {
          draft.grants.set(terms.runId, [...(draft.grants.get(terms.runId) ?? []), terms]);
          draft.issued.push(terms);
          return Promise.resolve(`grant-${terms.phase}-${terms.runId}` as GrantToken);
        },
        revoke: (runId, phase) => {
          const kept = (draft.grants.get(runId) ?? []).filter(
            (terms) => phase !== undefined && terms.phase !== phase,
          );
          if (kept.length === 0) draft.grants.delete(runId);
          else draft.grants.set(runId, kept);
          return Promise.resolve();
        },
        refusal: (runId) => Promise.resolve(draft.refusals.get(runId) ?? null),
      },
    };
  }

  get(id: TaskIdType) {
    return Promise.resolve(this.state.tasks.get(id) ?? null);
  }

  findBySubmission(requester: UserIdType, key: string) {
    const id = this.state.keys.get(submissionKey(requester, key));
    return Promise.resolve(id === undefined ? null : (this.state.tasks.get(id) ?? null));
  }

  history(id: TaskIdType) {
    return Promise.resolve(
      this.state.history.filter((entry) => entry.taskId === id).map((entry) => entry.event),
    );
  }

  task(id: TaskIdType): Task {
    const task = this.state.tasks.get(id);
    if (task === undefined) throw new Error(`No task ${id}`);
    return task;
  }

  /** The question the task waits on an answer to. */
  question(id: TaskIdType): QuestionIdType {
    const { state } = this.task(id);
    if (state.kind !== 'awaiting-reply') throw new Error(`Task ${id} is ${state.kind}`);
    return state.questionId;
  }

  jobsOf(queue: Job['queue']) {
    return this.state.jobs.filter((entry) => entry.job.queue === queue);
  }
}

export class FixedClock implements Clock {
  constructor(public time: Instant = 1_000) {}
  now() {
    return this.time;
  }
}

export class SequentialIds implements IdGenerator {
  private next = 0;
  task() {
    this.next += 1;
    return TaskId(`task-${String(this.next)}`);
  }
  run() {
    this.next += 1;
    return RunId(`run-${String(this.next)}`);
  }
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

export const ann: User = { id: UserId('ann'), name: 'Ann Lee', email: 'ann@example.com' };
export const bob: User = { id: UserId('bob'), name: 'Bob', email: null };

export class FakeIdentity implements Identity {
  constructor(private readonly users: readonly User[] = [ann, bob]) {}
  authenticate(token: string) {
    return Promise.resolve(this.users.find((user) => `token-${user.id}` === token) ?? null);
  }
  get(id: UserIdType) {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }
}

export const project = (overrides: Partial<Project> = {}): Project => ({
  id: ProjectId('acme'),
  name: 'Acme Web',
  access: { kind: 'everyone' },
  repository: { host: 'github', name: 'acme/web', baseBranch: 'main' },
  policy: {
    maxQuestions: 2,
    maxRunAttempts: 3,
    maxPublishAttempts: 3,
    replyTimeoutMs: 60_000,
    onReplyTimeout: 'proceed',
    retryBaseMs: 1_000,
    retryMaxMs: 60_000,
  },
  changePolicy: DEFAULT_CHANGE_POLICY,
  execution: {
    image: 'redline-agent@sha256:1',
    model: 'claude-opus-5-5',
    maxTurns: 100,
    timeoutMs: 3_600_000,
    stallTimeoutMs: 600_000,
    budget: { usd: 10, tokens: 10_000_000 },
    setupHosts: ['registry.npmjs.org'],
    setupSecrets: {},
  },
  publishing: { target: 'branch', draft: true },
  ...overrides,
});

export class FakeCatalog implements ProjectCatalog {
  constructor(public projects: Project[] = [project()]) {}
  list() {
    return this.projects;
  }
  get(id: ProjectId) {
    return this.projects.find((candidate) => candidate.id === id) ?? null;
  }
}

export const MANIFEST = 'a'.repeat(64) as BlobDigest;

export const bundle: BundleContents = {
  steps: [
    {
      id: 'step-1',
      url: 'https://staging.acme.io/pricing',
      comment: 'Rename "Most popular" to "Best value"',
      viewport: { width: 1280, height: 800 },
      files: [],
    },
  ],
  files: [{ path: 'context.md', digest: 'b'.repeat(64) as BlobDigest, mediaType: 'text/markdown' }],
  entry: 'context.md',
};

export class FakeBundles implements BundleReader {
  constructor(public contents: BundleContents | null = bundle) {}
  read() {
    return Promise.resolve(this.contents);
  }
}

export class MemoryVault implements CredentialVault {
  readonly credentials = new Map<TaskIdType, ModelCredential>();
  deposit(taskId: TaskIdType, credential: ModelCredential) {
    this.credentials.set(taskId, credential);
    return Promise.resolve();
  }
  held(taskId: TaskIdType) {
    return Promise.resolve(this.credentials.get(taskId)?.kind ?? null);
  }
  forget(taskId: TaskIdType) {
    this.credentials.delete(taskId);
    return Promise.resolve();
  }
}

export const apiKey = new ModelCredential('api-key', 'sk-ant-api-secret');
export const subscription = new ModelCredential('subscription', 'sk-ant-oat-secret');

export const managed: ModelAccessPolicy = {
  credentials: 'managed',
  operator: 'api-key',
  acceptRequesterSubscriptions: false,
};

/** The ledger in memory: a request reserves at once, the way the database does under its lock. */
export class MemoryLedger implements UsageLedger {
  readonly entries: {
    readonly reservation: string;
    readonly request: MeteredRequest;
    usage: TokenUsage | null;
    spending: Budget;
    settled: boolean;
  }[] = [];

  reserve(request: MeteredRequest, amount: Budget, admits: (spent: Budget) => boolean) {
    if (!admits(this.spentBy(request.taskId))) return Promise.resolve(null);
    const reservation = `reservation-${String(this.entries.length + 1)}`;
    this.entries.push({ reservation, request, usage: null, spending: amount, settled: false });
    return Promise.resolve(reservation);
  }

  settle(reservation: string, usage: TokenUsage, spending: Budget) {
    const entry = this.entries.find((each) => each.reservation === reservation && !each.settled);
    if (entry !== undefined) Object.assign(entry, { usage, spending, settled: true });
    return Promise.resolve();
  }

  /** Spending of an earlier request of the task, already settled. */
  spend(request: MeteredRequest, spending: Budget): void {
    this.entries.push({
      reservation: `earlier-${String(this.entries.length + 1)}`,
      request,
      usage: null,
      spending,
      settled: true,
    });
  }

  spentBy(taskId: string): Budget {
    const own = this.entries.filter((entry) => entry.request.taskId === taskId);
    return {
      usd: own.reduce((sum, entry) => sum + entry.spending.usd, 0),
      tokens: own.reduce((sum, entry) => sum + entry.spending.tokens, 0),
    };
  }
}

/** The gateway's grants in memory: their terms by token, and its refusals of runs. */
export class MemoryGrantBook implements GrantBook {
  readonly refusals = new Map<RunId, GatewayRefusal>();
  constructor(readonly byToken: Map<string, GrantTerms> = new Map()) {}
  terms(token: string) {
    return Promise.resolve(this.byToken.get(token) ?? null);
  }
  refusalOf(runId: RunId) {
    return Promise.resolve(this.refusals.get(runId) ?? null);
  }
  setRefusal(runId: RunId, refusal: GatewayRefusal | null) {
    if (refusal === null) this.refusals.delete(runId);
    else this.refusals.set(runId, refusal);
    return Promise.resolve();
  }
}

/** An agent runner that plays outcomes a test chose, one per run, in order. */
export class FakeRunner implements AgentRunner {
  readonly started: RunSpec[] = [];
  readonly released: string[] = [];
  startError: RunnerError | null = null;
  /** Whether the paused sessions it is asked about can be resumed. */
  resumes = true;
  /** Called as each run starts, e.g. for the gateway to refuse it. */
  onStart: (spec: RunSpec) => void = () => undefined;
  constructor(public outcomes: (RunOutcome | { kind: 'lost'; detail: string })[] = []) {}

  resumable() {
    return Promise.resolve(this.resumes);
  }

  start(spec: RunSpec) {
    if (this.startError !== null)
      return Promise.resolve({ ok: false as const, error: this.startError });
    this.started.push(spec);
    this.onStart(spec);
    return Promise.resolve({ ok: true as const });
  }
  observe(_runId: RunId, _signal: AbortSignal, phases: RunPhases) {
    void phases.setupDone();
    const next = this.outcomes.shift();
    if (next === undefined) throw new Error('No outcome scripted');
    return Promise.resolve(next);
  }
  release(runId: RunId) {
    this.released.push(runId);
    return Promise.resolve();
  }
  live() {
    return Promise.resolve(
      this.started.map((spec) => spec.runId).filter((runId) => !this.released.includes(runId)),
    );
  }
}

const done = <T>(value: T): Promise<Publishing<T>> => Promise.resolve({ ok: true, value });

/** A git host and mirror that remember what was pushed and opened. */
export class FakeGit implements SourceRepository, Forge, SecretScanner {
  baseSha = 'base-sha';
  description: Omit<ChangeDescription, 'secrets'> = {
    entries: [
      {
        path: 'src/PlanCard.tsx',
        previousPath: null,
        status: 'modified',
        mode: 'file',
        binary: false,
        bytes: 900,
        addedLines: 1,
        removedLines: 1,
      },
    ],
    scriptChanges: [],
  };
  secrets: SecretFinding[] = [];
  commits: DeterministicCommit[] = [];
  pushes: { sha: string; branch: string }[] = [];
  opened: ChangeRequestDraft[] = [];
  closed: ChangeRequestRef[] = [];
  open_: Map<string, ChangeRequestRef> = new Map();
  /** Fails the next call of the named operation. */
  failures = new Map<string, PublishError>();

  private outcome<T>(operation: string, value: () => T): Promise<Publishing<T>> {
    const failure = this.failures.get(operation);
    if (failure !== undefined) {
      this.failures.delete(operation);
      return Promise.resolve({ ok: false, error: failure });
    }
    return done(value());
  }

  prepare() {
    return this.outcome('prepare', () => ({ baseSha: this.baseSha }));
  }
  describe() {
    return this.outcome('describe', () => this.description);
  }
  scan() {
    return this.outcome('scan', () => this.secrets);
  }
  commit(_: unknown, commit: DeterministicCommit) {
    return this.outcome('commit', () => {
      this.commits.push(commit);
      return { sha: `sha-of-${commit.taskId}` };
    });
  }
  push(_: unknown, __: unknown, sha: string, branch: string) {
    return this.outcome('push', () => {
      this.pushes.push({ sha, branch });
    });
  }
  findOpen(_: unknown, __: unknown, branch: string) {
    return this.outcome('findOpen', () => this.open_.get(branch) ?? null);
  }
  open(_: unknown, __: unknown, draft: ChangeRequestDraft) {
    return this.outcome('open', () => {
      this.opened.push(draft);
      const ref = {
        id: String(this.opened.length),
        url: `https://git.example/acme/web/pull/${String(this.opened.length)}`,
      };
      this.open_.set(draft.branch, ref);
      return ref;
    });
  }
  close(_: unknown, change: ChangeRequestRef) {
    return this.outcome('close', () => {
      this.closed.push(change);
      for (const [branch, ref] of this.open_) if (ref.id === change.id) this.open_.delete(branch);
    });
  }
}
