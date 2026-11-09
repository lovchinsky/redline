import type { CredentialKind } from '../domain/grant';
import type { ChangePolicyRules } from '../domain/change-policy';
import type { ProjectId, TaskId, UserId } from '../domain/ids';
import type { TaskPolicy } from '../domain/policy';

export interface User {
  readonly id: UserId;
  readonly name: string;
  /** Used only to credit the requester in a change request. */
  readonly email: string | null;
}

/** Who is calling: the bearer token of a request, resolved to its user. */
export interface Identity {
  authenticate(token: string): Promise<User | null>;
  get(id: UserId): Promise<User | null>;
}

/** Where a project's code lives on its git host. */
export interface RepositoryRef {
  /** The connection to the git host, by its name in the configuration. */
  readonly host: string;
  /** The repository on that host, e.g. `acme/web`. */
  readonly name: string;
  readonly baseBranch: string;
}

export interface PublishingProfile {
  /** `fork`: the branch goes to a fork the bot owns; `branch`: to the repository itself. */
  readonly target: 'fork' | 'branch';
  readonly draft: boolean;
}

/** How the agent runs for a project. */
export interface ExecutionProfile {
  /** The sandbox image, pinned by digest. */
  readonly image: string;
  readonly model: string;
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** A run without any sign of life for this long has stalled. */
  readonly stallTimeoutMs: number;
  /** Budget of one task: dollars with an API key, tokens with a subscription. */
  readonly budget: { readonly usd: number; readonly tokens: number };
  /** Package registries the setup phase may reach. */
  readonly setupHosts: readonly string[];
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /** Who may submit to the project; everyone authenticated, or listed users. */
  readonly access:
    { readonly kind: 'everyone' } | { readonly kind: 'users'; readonly users: readonly UserId[] };
  readonly repository: RepositoryRef;
  readonly policy: TaskPolicy;
  readonly changePolicy: ChangePolicyRules;
  readonly execution: ExecutionProfile;
  readonly publishing: PublishingProfile;
}

export interface ProjectCatalog {
  list(): readonly Project[];
  get(id: ProjectId): Project | null;
}

export const canSubmit = (project: Project, user: UserId): boolean =>
  project.access.kind === 'everyone' || project.access.users.includes(user);

/**
 * A model credential of the requester. It travels with the extension's requests and lives only
 * in memory; its secret never reaches logs, storage or JSON.
 */
export class ModelCredential {
  readonly #secret: string;

  constructor(
    readonly kind: CredentialKind,
    secret: string,
  ) {
    this.#secret = secret;
  }

  reveal(): string {
    return this.#secret;
  }

  toJSON() {
    return { kind: this.kind, secret: '[redacted]' };
  }

  toString() {
    return `ModelCredential(${this.kind})`;
  }
}

/**
 * Where the model credentials of tasks come from (configuration, ADR-R13): the operator's own
 * (`managed`), the requester's own on every request (`required`), or the requester's when given
 * and the operator's otherwise (`optional`).
 */
export interface ModelAccessPolicy {
  readonly credentials: 'managed' | 'required' | 'optional';
  /** The kind of the operator's own credential; null when there is none (`required`). */
  readonly operator: CredentialKind | null;
  /** Whether requesters may bring a subscription token, not only an API key. */
  readonly acceptRequesterSubscriptions: boolean;
}

/**
 * Requesters' credentials, held in memory where the model is called (the gateway) for as long
 * as their tasks need them. Nothing here is ever written to disk.
 */
export interface CredentialVault {
  deposit(taskId: TaskId, credential: ModelCredential): Promise<void>;
  /** The kind of the credential held for the task, or null when none is. */
  held(taskId: TaskId): Promise<CredentialKind | null>;
  forget(taskId: TaskId): Promise<void>;
}

/** The vault as the gateway, the one component that uses the credentials, reads it. */
export interface HeldCredentials {
  credentialOf(taskId: TaskId): ModelCredential | null;
}
