import type { QuestionId, TaskId } from '../domain/ids';
import { err, ok, type Result } from '../domain/result';
import { answerQuestion, submitTask, type Task } from '../domain/task';
import {
  canSubmit,
  type CredentialVault,
  type ModelAccessPolicy,
  type ModelCredential,
  type ProjectCatalog,
  type User,
} from '../ports/access';
import type { BundleContents, BundleReader } from '../ports/bundles';
import type { Clock, IdGenerator } from '../ports/system';
import type { ProjectListing, Requests, Submission } from '../ports/requests';
import type { TaskQueries } from '../ports/tasks';
import { credentialsFor, type CredentialRelay } from './credentials';
import { invalid, notFound, type RequestError } from './errors';
import type { TaskWriter } from './task-writer';

const TITLE_LENGTH = 72;

/** The first step's comment on one line, shortened: how people recognise the task. */
export const titleOf = (bundle: BundleContents): string => {
  const comment = (bundle.steps[0]?.comment ?? '').replace(/\s+/g, ' ').trim();
  if (comment === '') return 'Untitled change';
  return comment.length <= TITLE_LENGTH
    ? comment
    : `${comment.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
};

/** The receiver's answers to the extension (`Requests`), on top of the domain's transitions. */
export class TaskRequests implements Requests {
  constructor(
    private readonly deps: {
      readonly queries: TaskQueries;
      readonly writer: TaskWriter;
      readonly projects: ProjectCatalog;
      readonly bundles: BundleReader;
      readonly vault: CredentialVault;
      readonly relay: CredentialRelay;
      readonly access: ModelAccessPolicy;
      readonly ids: IdGenerator;
      readonly clock: Clock;
    },
  ) {}

  listProjects(user: User): ProjectListing {
    return {
      projects: this.deps.projects
        .list()
        .filter((project) => canSubmit(project, user.id))
        .map(({ id, name }) => ({ id, name })),
      modelCredential: this.deps.access.credentials,
    };
  }

  async findSubmitted(
    user: User,
    idempotencyKey: string,
    credential: ModelCredential | null,
  ): Promise<Task | null> {
    const task = await this.deps.queries.findBySubmission(user.id, idempotencyKey);
    if (task !== null) await this.deps.relay.refresh(task, credential);
    return task;
  }

  async submit(submission: Submission): Promise<Result<Task, RequestError>> {
    const project = this.deps.projects.get(submission.projectId);
    // A project the user may not submit to is as unknown as one that does not exist.
    if (project === null || !canSubmit(project, submission.requester.id)) {
      return err(invalid('Unknown project'));
    }
    const credentials = credentialsFor(this.deps.access, submission.credential);
    if (!credentials.ok) return credentials;
    const bundle = await this.deps.bundles.read(submission.manifest);
    if (bundle === null) return err(invalid('The bundle was not stored'));

    const transition = submitTask(
      {
        id: this.deps.ids.task(),
        requester: submission.requester.id,
        projectId: project.id,
        bundle: { manifest: submission.manifest, title: titleOf(bundle) },
        credentials: credentials.value,
      },
      this.deps.clock.now(),
    );
    // The credential is in place before the task exists, so its first run never waits for it.
    const { credential } = submission;
    if (credentials.value === 'requester' && credential !== null) {
      await this.deps.vault.deposit(transition.task.id, credential);
    }
    const created = await this.deps.writer.create(transition, submission.idempotencyKey);
    if (created.inserted) return ok(created.task);
    // A concurrent submission with the same key won: its task is the answer.
    await this.deps.vault.forget(transition.task.id);
    await this.deps.relay.refresh(created.existing, credential);
    return ok(created.existing);
  }

  async state(
    user: User,
    taskId: TaskId,
    credential: ModelCredential | null,
  ): Promise<Result<Task, RequestError>> {
    const task = await this.own(user, taskId);
    if (task === null) return err(notFound());
    await this.deps.relay.refresh(task, credential);
    return ok(task);
  }

  async reply(
    user: User,
    taskId: TaskId,
    answer: { readonly questionId: QuestionId; readonly text: string },
    credential: ModelCredential | null,
  ): Promise<Result<Task, RequestError>> {
    const task = await this.own(user, taskId);
    if (task === null) return err(notFound());
    // The credential first: the run this answer schedules needs it.
    await this.deps.relay.refresh(task, credential);
    const answered = await this.deps.writer.update(taskId, (current, now) =>
      answerQuestion(current, answer.questionId, answer.text, now),
    );
    return answered.ok ? ok(answered.value.transition.task) : answered;
  }

  /** A task of this user; someone else's task is not found, as if it did not exist. */
  private async own(user: User, taskId: TaskId): Promise<Task | null> {
    const task = await this.deps.queries.get(taskId);
    return task !== null && task.requester === user.id ? task : null;
  }
}
