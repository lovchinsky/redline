import type { Fault } from '../../domain/result';

export interface GitHubAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

/** A failed call, classified the way publishing retries: only what may pass is transient. */
export class GitHubError extends Error {
  constructor(
    readonly status: number | null,
    readonly transient: boolean,
    message: string,
    /** What GitHub itself said: its message and those of its `errors`, as it wrote them. */
    readonly reasons: readonly string[] = [],
  ) {
    super(message);
  }

  toFault(): Fault {
    return { transient: this.transient, detail: this.message };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The messages of an error answer: its own, and each of its `errors`'. */
const reasonsOf = (body: unknown): string[] => {
  if (!isRecord(body)) return [];
  const own = typeof body['message'] === 'string' ? [body['message']] : [];
  const errors = Array.isArray(body['errors']) ? body['errors'] : [];
  return [
    ...own,
    ...errors.flatMap((entry: unknown) =>
      isRecord(entry) && typeof entry['message'] === 'string' ? [entry['message']] : [],
    ),
  ];
};

/**
 * Whether a failed answer may succeed when asked again: the server's errors, rate limits
 * (primary and secondary) and timeouts. Anything else is the configuration's or the request's.
 */
const transientOf = (answer: GitHubAnswer): boolean =>
  answer.status >= 500 ||
  answer.status === 429 ||
  answer.status === 408 ||
  (answer.status === 403 &&
    (answer.headers.get('x-ratelimit-remaining') === '0' ||
      answer.headers.has('retry-after') ||
      reasonsOf(answer.body).some((reason) => /rate limit/i.test(reason))));

/** GitHub's REST API, as the receiver calls it: JSON in and out, one version. */
export class GitHubApi {
  constructor(
    private readonly options: {
      /** `https://api.github.com`, or a GitHub Enterprise Server's `/api/v3`. */
      readonly url: string;
      readonly fetch?: typeof fetch;
    },
  ) {}

  /** Calls the API with `token` as its bearer; throws `GitHubError` unless the status is in `ok`. */
  async call(
    method: string,
    path: string,
    token: string,
    body?: unknown,
    ok: readonly number[] = [200, 201],
  ): Promise<GitHubAnswer> {
    const call = this.options.fetch ?? fetch;
    let response: Response;
    try {
      response = await call(`${this.options.url.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'redline-receiver',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new GitHubError(null, true, `GitHub is unreachable: ${String(error)}`);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }
    const answer = { status: response.status, headers: response.headers, body: parsed };
    if (!ok.includes(answer.status)) {
      const reasons = reasonsOf(parsed);
      throw new GitHubError(
        answer.status,
        transientOf(answer),
        `GitHub answered ${method} ${path} with ${String(answer.status)}${reasons.length === 0 ? '' : `: ${reasons.join('; ')}`}`,
        reasons,
      );
    }
    return answer;
  }
}
