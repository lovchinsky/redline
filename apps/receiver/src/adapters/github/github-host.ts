import type { ChangeRequestRef } from '../../domain/work';
import type { PublishingProfile, RepositoryRef } from '../../ports/access';
import type { ChangeRequestDraft, Forge, Publishing } from '../../ports/publishing';
import type { Logger } from '../../ports/system';
import { GitHubError, type GitHubApi } from './api';
import type { GitHubAuth } from './auth';

/** A repository as git reaches it on GitHub, with its token as the request's credentials. */
interface Remote {
  readonly url: string;
  readonly authorization: string;
}

/** The label a pull request carries when the repository takes no drafts. */
export const DRAFT_LABEL = 'redline:draft';

export interface GitHubHostOptions {
  readonly api: GitHubApi;
  readonly auth: GitHubAuth;
  /** Where git reaches repositories: `https://github.com`, or a GitHub Enterprise Server. */
  readonly gitUrl: string;
  /** The owner of the bot's forks, for projects that publish to a fork. */
  readonly forkOwner: string | null;
  readonly logger: Logger;
}

const field = (body: unknown, name: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[name] : undefined;

const refOf = (body: unknown): ChangeRequestRef | null => {
  const number = field(body, 'number');
  const url = field(body, 'html_url');
  return typeof number === 'number' && typeof url === 'string' ? { id: String(number), url } : null;
};

const caught = async <T>(work: () => Promise<T>): Promise<Publishing<T>> => {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof GitHubError) return { ok: false, error: error.toPublishError() };
    return { ok: false, error: { transient: true, detail: String(error) } };
  }
};

/**
 * A GitHub as the receiver's git host: where repositories are fetched and branches pushed, with
 * a token for that one repository each time, and where pull requests are found, opened and
 * closed. A project publishing to a fork pushes to the bot's fork and opens the pull request
 * from it; one publishing to a branch pushes to the repository itself.
 */
export class GitHubHost implements Forge {
  constructor(private readonly options: GitHubHostOptions) {}

  /** Where the repository is fetched from, with a token for it. */
  source(repository: RepositoryRef): Promise<Publishing<Remote | null>> {
    return caught(() =>
      repository.host === 'github' ? this.remoteOf(repository.name) : Promise.resolve(null),
    );
  }

  /** Where a task's branch goes: the bot's fork, or the repository itself. */
  target(
    repository: RepositoryRef,
    publishing: PublishingProfile,
  ): Promise<Publishing<Remote | null>> {
    return caught(() =>
      repository.host === 'github'
        ? this.remoteOf(this.headRepository(repository, publishing))
        : Promise.resolve(null),
    );
  }

  findOpen(repository: RepositoryRef, publishing: PublishingProfile, branch: string) {
    return caught(async () => {
      const token = await this.options.auth.tokenFor(repository.name);
      const head = `${this.headOwner(repository, publishing)}:${branch}`;
      const answer = await this.options.api.call(
        'GET',
        `/repos/${repository.name}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=1`,
        token,
      );
      const listed = Array.isArray(answer.body) ? (answer.body as unknown[]) : [];
      return listed.length === 0 ? null : refOf(listed[0]);
    });
  }

  open(repository: RepositoryRef, publishing: PublishingProfile, draft: ChangeRequestDraft) {
    return caught(async () => {
      const token = await this.options.auth.tokenFor(repository.name);
      const pull = {
        title: draft.title,
        head: `${this.headOwner(repository, publishing)}:${draft.branch}`,
        base: repository.baseBranch,
        body: draft.body,
        maintainer_can_modify: false,
      };
      let labels = [...draft.labels];
      let answer;
      try {
        answer = await this.options.api.call('POST', `/repos/${repository.name}/pulls`, token, {
          ...pull,
          draft: draft.draft,
        });
      } catch (error) {
        // A repository without draft pull requests (private, on a plan without them) gets an
        // ordinary one, labelled as a draft.
        if (!(
          draft.draft &&
          error instanceof GitHubError &&
          error.status === 422 &&
          error.reasons.some((reason) => /draft/i.test(reason))
        )) {
          throw error;
        }
        labels = [...labels, DRAFT_LABEL];
        answer = await this.options.api.call('POST', `/repos/${repository.name}/pulls`, token, {
          ...pull,
          draft: false,
        });
      }
      const ref = refOf(answer.body);
      if (ref === null)
        throw new GitHubError(answer.status, true, 'GitHub opened a pull request without a number');
      if (labels.length > 0) await this.label(repository, ref, labels, token);
      return ref;
    });
  }

  /**
   * Whether the task branches can go where the project publishes them: the repository itself,
   * or the bot's fork of it. Names the repository the branches go to.
   */
  checkTarget(repository: RepositoryRef, publishing: PublishingProfile) {
    return caught(async () => {
      const target = this.headRepository(repository, publishing);
      const answer = await this.options.api.call(
        'GET',
        `/repos/${target}`,
        await this.options.auth.tokenFor(target),
      );
      if (target !== repository.name) {
        const parent = field(field(answer.body, 'parent'), 'full_name');
        if (parent !== repository.name) {
          throw new GitHubError(
            answer.status,
            false,
            `${target} is not a fork of ${repository.name}`,
          );
        }
      }
      return target;
    });
  }

  close(repository: RepositoryRef, change: ChangeRequestRef) {
    return caught(async () => {
      const token = await this.options.auth.tokenFor(repository.name);
      await this.options.api.call('PATCH', `/repos/${repository.name}/pulls/${change.id}`, token, {
        state: 'closed',
      });
    });
  }

  /**
   * Labels are for people sorting pull requests; the body says the same. A pull request whose
   * labels could not be set is still the task's result.
   */
  private async label(
    repository: RepositoryRef,
    ref: ChangeRequestRef,
    labels: readonly string[],
    token: string,
  ) {
    try {
      await this.options.api.call(
        'POST',
        `/repos/${repository.name}/issues/${ref.id}/labels`,
        token,
        { labels },
      );
    } catch (error) {
      this.options.logger.warn('Could not label a pull request', {
        pull: ref.url,
        error: String(error),
      });
    }
  }

  private headOwner(repository: RepositoryRef, publishing: PublishingProfile): string {
    return this.headRepository(repository, publishing).split('/')[0] ?? '';
  }

  private headRepository(repository: RepositoryRef, publishing: PublishingProfile): string {
    if (publishing.target === 'branch') return repository.name;
    if (this.options.forkOwner === null) {
      throw new GitHubError(
        null,
        false,
        'The project publishes to a fork, and no fork owner is configured',
      );
    }
    return `${this.options.forkOwner}/${repository.name.split('/')[1] ?? repository.name}`;
  }

  private async remoteOf(repository: string) {
    const token = await this.options.auth.tokenFor(repository);
    return {
      url: `${this.options.gitUrl.replace(/\/$/, '')}/${repository}.git`,
      authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    };
  }
}
