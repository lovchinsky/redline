import { describe, expect, it } from 'vitest';
import type { Question } from './exchange';
import { ProjectId, QuestionId, RunId, TaskId, UserId, type BlobDigest } from './ids';
import type { TaskPolicy } from './policy';
import type { RunOutcome } from './run';
import {
  answerQuestion,
  applyOutcome,
  awaitCredential,
  beginRun,
  cancelTask,
  credentialArrived,
  expireQuestion,
  fixBase,
  isCurrentRun,
  loseRun,
  markPublished,
  recordPublishFailure,
  rejectByPolicy,
  submitTask,
  type Task,
  type TransitionResult,
} from './task';
import type { Snapshot } from './work';

const policy: TaskPolicy = {
  maxQuestions: 2,
  maxRunAttempts: 3,
  maxPublishAttempts: 3,
  replyTimeoutMs: 1_000,
  onReplyTimeout: 'proceed',
  retryBaseMs: 100,
  retryMaxMs: 1_000,
};

const digest = (char: string) => char.repeat(64) as BlobDigest;
const snapshot = (char: string, questionId: QuestionId | null = null): Snapshot => ({
  blob: digest(char),
  image: 'redline-agent@sha256:1',
  model: 'claude-opus-5-5',
  questionId,
});
/** The paused session of a queued task, as a runner that can resume any session sees it. */
const pausedOf = (task: Task): Snapshot | null =>
  task.state.kind === 'queued' ? task.state.resumeFrom : null;
const question = (id: string): Question => ({
  id: QuestionId(id),
  text: `Question ${id}?`,
  options: [],
});

const run1 = RunId('run-1');
const run2 = RunId('run-2');

const submitted = (): Task =>
  submitTask(
    {
      id: TaskId('task-1'),
      requester: UserId('ann'),
      projectId: ProjectId('acme'),
      bundle: { manifest: digest('a'), title: 'Rename the badge' },
      credentials: 'operator',
    },
    0,
  ).task;

const value = (result: TransitionResult) => {
  if (!result.ok) throw new Error(`Unexpected conflict: ${result.error.message}`);
  return result.value;
};

const running = (task = submitted(), runId = run1, now = 10) =>
  value(fixBase(value(beginRun(task, runId, pausedOf(task), now)).task, runId, 'base', now)).task;

const outcome = (task: Task, result: RunOutcome, runId = run1, now = 20) =>
  value(applyOutcome(task, runId, result, policy, now));

const asked = (id = 'q1', snap: Snapshot | null = snapshot('b', QuestionId(id))) =>
  outcome(running(), { kind: 'question', question: question(id), snapshot: snap }).task;

const report = { summary: 'Renamed', changes: [], verification: 'tests', assumptions: [] };
const publishing = () =>
  outcome(running(), {
    kind: 'change',
    change: { blob: digest('c'), head: 'b'.repeat(40) },
    report,
  }).task;

describe('submitting and starting', () => {
  it('queues a submitted task and schedules its first run', () => {
    const transition = submitTask(
      {
        id: TaskId('t'),
        requester: UserId('u'),
        projectId: ProjectId('p'),
        bundle: { manifest: digest('a'), title: 'T' },
        credentials: 'requester',
      },
      5,
    );
    expect(transition.task.state).toEqual({ kind: 'queued', resumeFrom: null, awaiting: null });
    expect(transition.effects).toEqual([{ kind: 'schedule-run', at: null }]);
    expect(transition.event).toEqual({ type: 'submitted', at: 5 });
  });

  it('fixes the base commit with the first run and keeps it for later ones', () => {
    const first = running();
    expect(first.baseSha).toBe('base');
    const requeued = outcome(first, {
      kind: 'failed',
      reason: 'infra',
      detail: 'oom',
      snapshot: null,
    }).task;
    const second = value(beginRun(requeued, run2, pausedOf(requeued), 30)).task;
    const kept = value(fixBase(second, run2, 'moved-on', 30));
    expect(kept.event).toBeNull();
    expect(kept.task.baseSha).toBe('base');
    expect(isCurrentRun(second, run2)).toBe(true);
  });

  it('fixes the base only for the current run', () => {
    const started = value(beginRun(submitted(), run1, pausedOf(submitted()), 10)).task;
    expect(fixBase(started, run2, 'base', 10).ok).toBe(false);
    expect(value(fixBase(started, run1, 'base', 10)).event).toEqual({
      type: 'base-fixed',
      runId: run1,
      baseSha: 'base',
      at: 10,
    });
  });

  it('starts runs only on queued tasks', () => {
    expect(beginRun(running(), run2, pausedOf(running()), 20).ok).toBe(false);
  });
});

describe('waiting for the credential', () => {
  it('waits for the credential once, and schedules the run when it comes', () => {
    const waiting = value(awaitCredential(submitted(), 5));
    expect(waiting.task.state).toEqual({
      kind: 'queued',
      resumeFrom: null,
      awaiting: 'credential',
    });
    expect(waiting.event).toEqual({ type: 'awaiting-credential', at: 5 });
    expect(waiting.effects).toEqual([]);
    expect(value(awaitCredential(waiting.task, 6)).event).toBeNull();

    const arrived = value(credentialArrived(waiting.task, 7));
    expect(arrived.task.state).toEqual({ kind: 'queued', resumeFrom: null, awaiting: null });
    expect(arrived.event).toEqual({ type: 'credential-arrived', at: 7 });
    expect(arrived.effects).toEqual([{ kind: 'schedule-run', at: null }]);
  });

  it('schedules nothing for a task that waits for no credential', () => {
    for (const task of [submitted(), running(), asked()]) {
      expect(value(credentialArrived(task, 7)).event).toBeNull();
    }
    expect(awaitCredential(running(), 7).ok).toBe(false);
  });
});

describe('run outcomes', () => {
  it('turns a question into an open exchange with a reply timeout', () => {
    const transition = outcome(running(), {
      kind: 'question',
      question: question('q1'),
      snapshot: snapshot('b', QuestionId('q1')),
    });
    expect(transition.task.state).toMatchObject({ kind: 'awaiting-reply', questionId: 'q1' });
    expect(transition.task.exchanges).toEqual([
      { question: question('q1'), askedAt: 20, answer: null, closed: false },
    ]);
    expect(transition.effects).toEqual([
      { kind: 'schedule-reply-timeout', questionId: 'q1', at: 20 + policy.replyTimeoutMs },
    ]);
  });

  it('fails a task whose agent asks more questions than the project allows', () => {
    let task = asked('q1');
    task = value(answerQuestion(task, QuestionId('q1'), 'yes', 30)).task;
    task = value(beginRun(task, run2, pausedOf(task), 40)).task;
    task = outcome(task, { kind: 'question', question: question('q2'), snapshot: null }, run2).task;
    task = value(answerQuestion(task, QuestionId('q2'), 'no', 50)).task;
    task = value(beginRun(task, RunId('run-3'), pausedOf(task), 60)).task;
    const third = outcome(
      task,
      { kind: 'question', question: question('q3'), snapshot: null },
      RunId('run-3'),
    );
    expect(third.task.state).toMatchObject({ kind: 'failed', failure: { code: 'agent-failed' } });
  });

  it('sends a change to publishing', () => {
    const transition = outcome(running(), {
      kind: 'change',
      change: { blob: digest('c'), head: 'b'.repeat(40) },
      report,
    });
    expect(transition.task.state).toEqual({
      kind: 'publishing',
      change: { blob: digest('c'), head: 'b'.repeat(40) },
      report,
    });
    expect(transition.effects).toEqual([{ kind: 'schedule-publish', at: null }]);
  });

  it('fails with the explanation when there is nothing to change', () => {
    const transition = outcome(running(), {
      kind: 'no-change',
      explanation: 'It already says "Best value".',
    });
    expect(transition.task.state).toEqual({
      kind: 'failed',
      failure: {
        code: 'no-change',
        message: 'The agent made no change: It already says "Best value".',
      },
    });
  });

  it('waits for the subscription limit to reset, without spending an attempt', () => {
    const transition = outcome(running(), {
      kind: 'quota-exhausted',
      resetAt: 5_000,
      snapshot: snapshot('d'),
    });
    expect(transition.task.state).toEqual({
      kind: 'queued',
      resumeFrom: snapshot('d'),
      awaiting: null,
    });
    expect(transition.task.runAttempts).toBe(0);
    expect(transition.effects).toEqual([{ kind: 'schedule-run', at: 5_000 }]);
  });

  it('retries infrastructure failures with growing delays, then fails', () => {
    let task = running();
    const delays: (number | null)[] = [];
    for (let attempt = 1; attempt < policy.maxRunAttempts; attempt += 1) {
      const transition = outcome(
        task,
        { kind: 'failed', reason: 'infra', detail: 'sandbox died', snapshot: null },
        RunId(`run-${String(attempt)}`),
        100,
      );
      const effect = transition.effects[0];
      delays.push(effect?.kind === 'schedule-run' && effect.at !== null ? effect.at - 100 : null);
      task = value(
        beginRun(
          transition.task,
          RunId(`run-${String(attempt + 1)}`),
          pausedOf(transition.task),
          200,
        ),
      ).task;
    }
    expect(delays).toEqual([100, 200]);
    const last = outcome(
      task,
      { kind: 'failed', reason: 'infra', detail: 'sandbox died', snapshot: null },
      RunId(`run-${String(policy.maxRunAttempts)}`),
    );
    expect(last.task.state).toMatchObject({ kind: 'failed', failure: { code: 'agent-failed' } });
  });

  it('starts over, told the exchanges, when the paused session cannot be resumed', () => {
    const answered = value(answerQuestion(asked(), QuestionId('q1'), 'yes', 30)).task;
    const replayed = value(beginRun(answered, run2, null, 40));
    expect(replayed.task.state).toEqual({ kind: 'running', runId: run2, resumedFrom: null });
    expect(replayed.event).toMatchObject({ type: 'run-started', resumed: false });
    expect(replayed.task.exchanges).toHaveLength(1);
    // Only the task's own paused session is resumed.
    expect(value(beginRun(answered, run2, snapshot('z'), 40)).task.state).toMatchObject({
      resumedFrom: null,
    });
  });

  it('resumes a run that failed before its own snapshot from the one it started from', () => {
    const resumed = value(
      beginRun(
        value(answerQuestion(asked(), QuestionId('q1'), 'yes', 30)).task,
        run2,
        pausedOf(value(answerQuestion(asked(), QuestionId('q1'), 'yes', 30)).task),
        40,
      ),
    ).task;
    const failed = outcome(
      resumed,
      { kind: 'failed', reason: 'infra', detail: 'oom', snapshot: null },
      run2,
    );
    expect(failed.task.state).toEqual({
      kind: 'queued',
      resumeFrom: snapshot('b', QuestionId('q1')),
      awaiting: null,
    });
  });

  it('waits for the credential without scheduling anything when the gateway lost it', () => {
    const transition = outcome(running(), { kind: 'credential-missing', snapshot: snapshot('e') });
    expect(transition.task.state).toEqual({
      kind: 'queued',
      resumeFrom: snapshot('e'),
      awaiting: 'credential',
    });
    expect(transition.effects).toEqual([]);
    expect(transition.task.runAttempts).toBe(0);
  });

  it.each([
    ['setup-failed', 'setup-failed'],
    ['repository-unavailable', 'repository-unavailable'],
    ['budget-exhausted', 'budget-exhausted'],
    ['agent-failed', 'agent-failed'],
    ['model-access-failed', 'model-access-failed'],
  ] as const)('fails a run that ended with %s', (reason, code) => {
    const transition = outcome(running(), {
      kind: 'failed',
      reason,
      detail: 'detail',
      snapshot: null,
    });
    expect(transition.task.state).toMatchObject({ kind: 'failed', failure: { code } });
  });

  it('refuses the outcome of a run that is no longer current', () => {
    const cancelled = value(cancelTask(running(), 'stop', 15)).task;
    expect(
      applyOutcome(cancelled, run1, { kind: 'no-change', explanation: '' }, policy, 20).ok,
    ).toBe(false);
    expect(
      applyOutcome(running(), run2, { kind: 'no-change', explanation: '' }, policy, 20).ok,
    ).toBe(false);
  });

  it('treats a lost run as an infrastructure failure', () => {
    const transition = value(loseRun(running(), run1, 'no sandbox', policy, 20));
    expect(transition.task.state).toEqual({ kind: 'queued', resumeFrom: null, awaiting: null });
    expect(transition.task.runAttempts).toBe(1);
  });
});

describe('questions and answers', () => {
  it('queues the resumed session when the requester answers', () => {
    const transition = value(answerQuestion(asked(), QuestionId('q1'), 'Desktop only', 30));
    expect(transition.task.state).toEqual({
      kind: 'queued',
      resumeFrom: snapshot('b', QuestionId('q1')),
      awaiting: null,
    });
    expect(transition.task.exchanges[0]?.answer).toEqual({
      source: 'requester',
      text: 'Desktop only',
      at: 30,
    });
    expect(transition.effects).toEqual([{ kind: 'schedule-run', at: null }]);
  });

  it('accepts the same answer again without changing anything', () => {
    const answered = value(answerQuestion(asked(), QuestionId('q1'), 'Yes', 30)).task;
    const repeated = value(answerQuestion(answered, QuestionId('q1'), 'Yes', 40));
    expect(repeated.event).toBeNull();
    expect(repeated.task).toBe(answered);
    expect(answerQuestion(answered, QuestionId('q1'), 'No', 40).ok).toBe(false);
  });

  it('refuses an answer to a question that was not asked', () => {
    expect(answerQuestion(asked(), QuestionId('q9'), 'Yes', 30).ok).toBe(false);
    expect(answerQuestion(running(), QuestionId('q1'), 'Yes', 30).ok).toBe(false);
  });

  it('goes on with the agent’s own judgement when a question times out', () => {
    const transition = value(expireQuestion(asked(), QuestionId('q1'), policy, 1_100));
    expect(transition.task.state).toMatchObject({ kind: 'queued' });
    expect(transition.task.exchanges[0]?.answer).toEqual({ source: 'timeout', at: 1_100 });
    expect(transition.effects).toEqual([{ kind: 'schedule-run', at: null }]);
  });

  it('fails a timed-out question when the project does not go on without answers', () => {
    const transition = value(
      expireQuestion(asked(), QuestionId('q1'), { ...policy, onReplyTimeout: 'fail' }, 1_100),
    );
    expect(transition.task.state).toMatchObject({ kind: 'failed', failure: { code: 'no-reply' } });
  });

  it('ignores a timeout for a question answered meanwhile', () => {
    const answered = value(answerQuestion(asked(), QuestionId('q1'), 'Yes', 30)).task;
    const transition = value(expireQuestion(answered, QuestionId('q1'), policy, 1_100));
    expect(transition.event).toBeNull();
    expect(transition.task).toBe(answered);
  });

  it('takes a late answer while the run that goes on without it has not started', () => {
    const expired = value(expireQuestion(asked(), QuestionId('q1'), policy, 1_100)).task;
    const late = value(answerQuestion(expired, QuestionId('q1'), 'Desktop only', 1_200));
    expect(late.task.exchanges[0]?.answer).toEqual({
      source: 'requester',
      text: 'Desktop only',
      at: 1_200,
    });
    expect(late.effects).toEqual([]);

    const started = value(beginRun(expired, run2, pausedOf(expired), 1_150)).task;
    expect(answerQuestion(started, QuestionId('q1'), 'Desktop only', 1_200).ok).toBe(false);
  });

  it('takes no late answer once a run went on without it, even if the task is queued again', () => {
    const expired = value(expireQuestion(asked(), QuestionId('q1'), policy, 1_100)).task;
    const started = value(beginRun(expired, run2, pausedOf(expired), 1_150)).task;
    const requeued = outcome(
      started,
      { kind: 'quota-exhausted', resetAt: 5_000, snapshot: null },
      run2,
      1_160,
    ).task;
    expect(requeued.state.kind).toBe('queued');
    expect(answerQuestion(requeued, QuestionId('q1'), 'Desktop only', 1_200).ok).toBe(false);
  });
});

describe('ending', () => {
  const ofRequester = (): Task => ({ ...submitted(), credentials: 'requester' });

  it('lets go of the requester’s credential whichever way the task ends', () => {
    const ends = [
      cancelTask(ofRequester(), 'stop', 5),
      applyOutcome(
        running(ofRequester()),
        run1,
        { kind: 'no-change', explanation: 'done' },
        policy,
        20,
      ),
      markPublished(
        outcome(running(ofRequester()), {
          kind: 'change',
          change: { blob: digest('c'), head: 'b'.repeat(40) },
          report,
        }).task,
        { id: '1', url: 'https://git.example/pr/1' },
        30,
      ),
    ];
    for (const end of ends) {
      expect(value(end).effects).toContainEqual({ kind: 'forget-credential' });
    }
    // The operator's credential is not the task's to let go of; and an end is not repeated.
    expect(value(cancelTask(submitted(), 'stop', 5)).effects).toEqual([]);
    const cancelled = value(cancelTask(ofRequester(), 'stop', 5)).task;
    expect(value(cancelTask(cancelled, 'again', 6)).effects).toEqual([]);
  });
});

describe('publishing', () => {
  it('records the change request', () => {
    const transition = value(
      markPublished(publishing(), { id: '42', url: 'https://git.example/pr/42' }, 30),
    );
    expect(transition.task.state).toEqual({
      kind: 'published',
      changeRequest: { id: '42', url: 'https://git.example/pr/42' },
    });
    expect(transition.event).toEqual({
      type: 'published',
      url: 'https://git.example/pr/42',
      at: 30,
    });
  });

  it('retries transient publishing failures, then fails', () => {
    const first = value(
      recordPublishFailure(publishing(), { transient: true, detail: '502' }, policy, 100),
    );
    expect(first.task.publishAttempts).toBe(1);
    expect(first.effects).toEqual([{ kind: 'schedule-publish', at: 200 }]);
    const second = value(
      recordPublishFailure(first.task, { transient: true, detail: '502' }, policy, 300),
    );
    const third = value(
      recordPublishFailure(second.task, { transient: true, detail: '502' }, policy, 500),
    );
    expect(third.task.state).toMatchObject({ kind: 'failed', failure: { code: 'publish-failed' } });
  });

  it('fails at once on a permanent publishing failure', () => {
    const transition = value(
      recordPublishFailure(
        publishing(),
        { transient: false, detail: 'App uninstalled' },
        policy,
        100,
      ),
    );
    expect(transition.task.state).toEqual({
      kind: 'failed',
      failure: {
        code: 'publish-failed',
        message: 'The change could not be published: App uninstalled',
      },
    });
  });

  it('fails a change the policy rejects', () => {
    const transition = value(
      rejectByPolicy(publishing(), '.github/workflows/ci.yml is protected', 30),
    );
    expect(transition.task.state).toMatchObject({
      kind: 'failed',
      failure: { code: 'policy-rejected' },
    });
  });
});

describe('cancelling', () => {
  it.each([
    ['queued', submitted, []],
    ['awaiting a reply', () => asked(), []],
    ['running', () => running(), [{ kind: 'abort-run', runId: run1 }]],
    ['publishing', publishing, [{ kind: 'withdraw-change' }]],
  ] as const)('cancels a %s task with what it takes to stop it', (_, make, effects) => {
    const transition = value(cancelTask(make(), 'not needed', 30));
    expect(transition.task.state).toEqual({ kind: 'cancelled', reason: 'not needed' });
    expect(transition.effects).toEqual(effects);
  });

  it('withdraws the change request opened for a task cancelled while it was being published', () => {
    const cancelled = value(cancelTask(publishing(), 'not needed', 30)).task;
    const opened = value(markPublished(cancelled, { id: '1', url: 'https://x' }, 40));
    expect(opened.task.state).toEqual({ kind: 'cancelled', reason: 'not needed' });
    expect(opened.event).toEqual({ type: 'opened-after-cancel', url: 'https://x', at: 40 });
    expect(opened.effects).toEqual([{ kind: 'withdraw-change' }]);
  });

  it('cancels once and refuses finished tasks', () => {
    const cancelled = value(cancelTask(submitted(), 'x', 30)).task;
    expect(value(cancelTask(cancelled, 'x', 40)).event).toBeNull();
    const published = value(markPublished(publishing(), { id: '1', url: 'https://x' }, 30)).task;
    expect(cancelTask(published, 'x', 40).ok).toBe(false);
  });
});
