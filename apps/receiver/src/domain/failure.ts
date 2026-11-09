/** Why a task ended without a change request. */
export type FailureCode =
  /** The agent finished and found nothing to change, or decided it should not. */
  | 'no-change'
  /** The proposed change broke the project's change policy. */
  | 'policy-rejected'
  /** The task spent its budget before the agent finished. */
  | 'budget-exhausted'
  /** The agent failed, or the infrastructure failed more often than a task may retry. */
  | 'agent-failed'
  /** The project's setup command failed on the base commit. */
  | 'setup-failed'
  /** The project's repository could not be read. */
  | 'repository-unavailable'
  /** The change could not be published to the git host. */
  | 'publish-failed'
  /** Nobody answered the agent's question in time, and the project does not go on without one. */
  | 'no-reply'
  /** The model refused the credentials the task runs with. */
  | 'model-access-failed';

/** `message` is shown to the person who requested the change, as the reason of `failed`. */
export interface Failure {
  readonly code: FailureCode;
  readonly message: string;
}

const PREFIX: Record<FailureCode, string> = {
  'no-change': 'The agent made no change',
  'policy-rejected': 'The change was rejected by the project policy',
  'budget-exhausted': 'The task ran out of its budget',
  'agent-failed': 'The agent could not complete the task',
  'setup-failed': "The project's setup failed",
  'repository-unavailable': "The project's repository is not available",
  'publish-failed': 'The change could not be published',
  'no-reply': 'The question was not answered in time',
  'model-access-failed': 'The model refused the credentials of this task',
};

/** A failure whose message leads with what happened and follows with the detail, if any. */
export const failure = (code: FailureCode, detail?: string): Failure => {
  const trimmed = detail?.trim() ?? '';
  return { code, message: trimmed === '' ? PREFIX[code] : `${PREFIX[code]}: ${trimmed}` };
};
