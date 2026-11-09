import type { Flag } from '../domain/change-policy';
import type { Task } from '../domain/task';
import type { AgentReport } from '../domain/work';
import type { PublishingProfile, User } from '../ports/access';
import type { BundleContents } from '../ports/bundles';
import type { ChangeRequestDraft } from '../ports/publishing';

/** The branch a task publishes to: one per task, so publishing again finds its own work. */
export const branchOf = (task: Task): string => `redline/${task.id}`;

/** The marker that ties a change request to its task. Written by the receiver only. */
export const taskMarker = (task: Task): string => `<!-- redline-task:${task.id} -->`;

/**
 * Text from outside the receiver (comments, page URLs, the agent's report, file names) shown as
 * a fenced block: nothing in it is interpreted, so it cannot mention people, close issues, embed
 * images or forge the task marker. The fence is longer than any backtick run inside.
 */
export const fenced = (text: string): string => {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
};

/** How long a commit subject or change request title may be. */
const SUBJECT_LIMIT = 72;

/**
 * The requester's title as one line that git hosts take as plain words: it cannot mention
 * anyone, refer to or close an issue, or link anywhere. A reference is broken apart (`@ ann`,
 * `# 12`), a link is left out; the request itself is in the body, fenced, word for word.
 */
export const subjectOf = (text: string): string => {
  const plain = text
    .replace(/\s+/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '(link)')
    .replace(/@(?=[\w-])/g, '@ ')
    .replace(/#(?=\d)/g, '# ')
    .trim();
  return plain.length <= SUBJECT_LIMIT ? plain : `${plain.slice(0, SUBJECT_LIMIT - 1).trimEnd()}…`;
};

const flagLine = (flag: Flag): string =>
  flag.kind === 'flagged-path'
    ? `${flag.path} (${flag.pattern})`
    : `${flag.path}: scripts ${flag.scripts.join(', ')}`;

export interface ChangeRequestInput {
  readonly task: Task;
  readonly report: AgentReport;
  readonly flags: readonly Flag[];
  readonly bundle: BundleContents;
  readonly requester: User | null;
  readonly publishing: PublishingProfile;
}

const sections = (input: ChangeRequestInput): string[] => {
  const { task, report, flags, bundle, requester } = input;
  const out: string[] = [
    `Requested by ${requester === null ? 'a Redline user' : `**${requester.name}**`} with Redline. ` +
      'The change was made by an AI agent: review it as any other contribution.',
  ];

  out.push('## Request');
  bundle.steps.forEach((step, index) => {
    out.push(
      `### Step ${String(index + 1)} · ${String(step.viewport.width)}×${String(step.viewport.height)}`,
      fenced(`${step.url}\n\n${step.comment}`),
    );
  });

  out.push('## What the agent did', fenced(report.summary));
  if (report.changes.length > 0) {
    out.push(
      '### Files',
      fenced(report.changes.map((change) => `${change.file}: ${change.why}`).join('\n')),
    );
  }
  if (report.verification.trim() !== '') out.push('### Verification', fenced(report.verification));
  if (report.assumptions.length > 0) {
    out.push(
      '### Assumptions',
      fenced(report.assumptions.map((assumption) => `- ${assumption}`).join('\n')),
    );
  }

  if (task.exchanges.length > 0) {
    out.push(
      '## Questions and answers',
      fenced(
        task.exchanges
          .map((exchange) => {
            const answer =
              exchange.answer === null
                ? '(no answer)'
                : exchange.answer.source === 'requester'
                  ? exchange.answer.text
                  : '(not answered in time: the agent decided)';
            return `Q: ${exchange.question.text}\nA: ${answer}`;
          })
          .join('\n\n'),
      ),
    );
  }

  if (flags.length > 0) {
    out.push(
      '## Needs attention',
      'The project asks a reviewer to look at these closely:',
      fenced(flags.map(flagLine).join('\n')),
    );
  }

  out.push(taskMarker(task));
  return out;
};

export const composeChangeRequest = (input: ChangeRequestInput): ChangeRequestDraft => ({
  branch: branchOf(input.task),
  title: subjectOf(`Redline: ${input.task.bundle.title}`),
  body: sections(input).join('\n\n'),
  draft: input.publishing.draft,
  labels: input.flags.length > 0 ? ['redline', 'redline:needs-attention'] : ['redline'],
});

/** The message of the one commit a task publishes; trailers credit the requester. */
export const composeCommitMessage = (task: Task, requester: User | null): string => {
  const trailers = [`Redline-Task: ${task.id}`];
  if (requester !== null) {
    trailers.push(
      `Requested-by: ${requester.name}${requester.email === null ? '' : ` <${requester.email}>`}`,
    );
  }
  return `${subjectOf(`Redline: ${task.bundle.title}`)}\n\n${trailers.join('\n')}\n`;
};
