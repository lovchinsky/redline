import { sign } from 'node:crypto';
import type { Clock } from '../../ports/system';
import { GitHubError, type GitHubApi } from './api';

/**
 * Where the API lists the repositories a grant reaches: with `token`, at `path`, its answers
 * the repositories themselves or (`within`) a field holding them.
 */
export interface Listing {
  readonly token: string;
  readonly path: string;
  readonly within: string | null;
}

/** The receiver's credential on GitHub: what it reaches, and a token for each repository. */
export interface GitHubAuth {
  /** A token that may act on one repository (`owner/name`) for publishing. */
  tokenFor(repository: string): Promise<string>;
  /** Where the repositories the credential reaches are listed, one listing per grant. */
  listings(): Promise<readonly Listing[]>;
  /** The token of the account the credential is, to ask who it is; null for an App. */
  accountToken(): string | null;
}

/** A bot's fine-grained personal access token: the same for every repository it was given. */
export class TokenAuth implements GitHubAuth {
  constructor(private readonly token: string) {}

  tokenFor(): Promise<string> {
    return Promise.resolve(this.token);
  }

  /** A fine-grained token lists the repositories it was given; a classic one, its user's. */
  listings(): Promise<readonly Listing[]> {
    return Promise.resolve([{ token: this.token, path: '/user/repos', within: null }]);
  }

  accountToken(): string {
    return this.token;
  }
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** What an installation token may do: write code and pull requests, never workflows. */
const PERMISSIONS = { contents: 'write', pull_requests: 'write', metadata: 'read' } as const;
/** A token is renewed this long before it expires, so no call starts with one about to lapse. */
const RENEW_BEFORE_MS = 5 * 60_000;

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;

/**
 * A GitHub App: a short-lived JWT signed with the App's key finds the installation of each
 * repository, whose token is asked for that one repository and the permissions publishing
 * needs. Tokens live in memory until shortly before they expire.
 */
export class AppAuth implements GitHubAuth {
  private readonly installations = new Map<string, number>();
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly options: {
      readonly api: GitHubApi;
      /** The App's id or client id: the JWT's issuer. */
      readonly appId: string;
      readonly privateKey: string;
      readonly clock: Clock;
    },
  ) {}

  async tokenFor(repository: string): Promise<string> {
    const now = this.options.clock.now();
    const cached = this.tokens.get(repository);
    if (cached !== undefined && cached.expiresAt - RENEW_BEFORE_MS > now) return cached.token;
    const installation = await this.installationOf(repository);
    const name = repository.split('/')[1] ?? repository;
    const answer = await this.options.api.call(
      'POST',
      `/app/installations/${String(installation)}/access_tokens`,
      this.jwt(),
      { repositories: [name], permissions: PERMISSIONS },
    );
    const token = field(answer.body, 'token');
    const expiresAt = Date.parse(String(field(answer.body, 'expires_at')));
    if (typeof token !== 'string' || Number.isNaN(expiresAt)) {
      throw new GitHubError(answer.status, true, 'GitHub answered without an installation token');
    }
    this.tokens.set(repository, { token, expiresAt });
    return token;
  }

  /** Each installation of the App lists its repositories, with a token of its own. */
  async listings(): Promise<readonly Listing[]> {
    const answer = await this.options.api.call(
      'GET',
      '/app/installations?per_page=100',
      this.jwt(),
    );
    const installations = Array.isArray(answer.body) ? answer.body : [];
    const listings: Listing[] = [];
    for (const installation of installations) {
      const id = field(installation, 'id');
      if (typeof id !== 'number') continue;
      const granted = await this.options.api.call(
        'POST',
        `/app/installations/${String(id)}/access_tokens`,
        this.jwt(),
        { permissions: { metadata: 'read' } },
      );
      const token = field(granted.body, 'token');
      if (typeof token !== 'string') {
        throw new GitHubError(
          granted.status,
          true,
          'GitHub answered without an installation token',
        );
      }
      listings.push({ token, path: '/installation/repositories', within: 'repositories' });
    }
    return listings;
  }

  /** An App is no account: its installations act for it. */
  accountToken(): null {
    return null;
  }

  private async installationOf(repository: string): Promise<number> {
    const known = this.installations.get(repository);
    if (known !== undefined) return known;
    const answer = await this.options.api.call(
      'GET',
      `/repos/${repository}/installation`,
      this.jwt(),
    );
    const id = field(answer.body, 'id');
    if (typeof id !== 'number')
      throw new GitHubError(answer.status, false, `The App is not installed on ${repository}`);
    this.installations.set(repository, id);
    return id;
  }

  /** The App's own JWT: issued a minute in the past for clock skew, valid for nine minutes. */
  private jwt(): string {
    const seconds = Math.floor(this.options.clock.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: this.options.appId }),
    );
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      this.options.privateKey,
    );
    return `${header}.${payload}.${base64url(signature)}`;
  }
}
