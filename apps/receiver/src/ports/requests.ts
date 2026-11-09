import type { BlobDigest, ProjectId, QuestionId, TaskId } from '../domain/ids';
import type { Result } from '../domain/result';
import type { Task } from '../domain/task';
import type { ModelAccessPolicy, ModelCredential, User } from './access';

/** Why a request to the receiver is refused, in terms the HTTP adapter maps to the contract. */
export type RequestError =
  /** No such task for this requester: unknown, someone else's, or no longer kept. */
  | { readonly code: 'not-found'; readonly message: string }
  /** The task's state does not allow it, e.g. answering a question that is not open. */
  | { readonly code: 'conflict'; readonly message: string }
  /** The request itself is wrong: an unknown project, a malformed answer. */
  | { readonly code: 'invalid'; readonly message: string }
  /** The receiver needs the requester's model credential, or does not take this kind of it. */
  | {
      readonly code: 'credential';
      readonly reason: 'required' | 'refused-kind';
      readonly message: string;
    };

export interface ProjectListing {
  readonly projects: readonly { readonly id: ProjectId; readonly name: string }[];
  readonly modelCredential: ModelAccessPolicy['credentials'];
}

export interface Submission {
  readonly requester: User;
  readonly idempotencyKey: string;
  readonly projectId: ProjectId;
  /** The stored and verified `manifest.json` of the bundle. */
  readonly manifest: BlobDigest;
  readonly credential: ModelCredential | null;
}

/**
 * What the extension asks of the receiver: projects, new tasks, their state, answers. The
 * receiver's driving port: the HTTP adapter calls it, the application implements it.
 */
export interface Requests {
  listProjects(user: User): ProjectListing;
  /** The task a requester already submitted under this key: its body need not be read again. */
  findSubmitted(
    user: User,
    idempotencyKey: string,
    credential: ModelCredential | null,
  ): Promise<Task | null>;
  submit(submission: Submission): Promise<Result<Task, RequestError>>;
  state(
    user: User,
    taskId: TaskId,
    credential: ModelCredential | null,
  ): Promise<Result<Task, RequestError>>;
  reply(
    user: User,
    taskId: TaskId,
    answer: { readonly questionId: QuestionId; readonly text: string },
    credential: ModelCredential | null,
  ): Promise<Result<Task, RequestError>>;
}
