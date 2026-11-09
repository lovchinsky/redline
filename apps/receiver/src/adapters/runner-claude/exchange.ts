import {
  AGENT_PROTOCOL_VERSION,
  type Brief,
  type Outcome,
  type Pause,
} from '@redline/agent-protocol';
import { QuestionId, type BlobDigest, type RunId } from '../../domain/ids';
import type { RunOutcome } from '../../domain/run';
import type { Snapshot } from '../../domain/work';
import type { RunSpec } from '../../ports/agent';
import type { RepositorySettings } from './repository-settings';

/**
 * The run in the agent protocol's terms: what the receiver knows about it, as agent-host reads
 * it, and the paused session it goes on with. The budget the agent sees is the dollars of an
 * API key; with a subscription the gateway counts tokens, and the agent has no estimate to stop
 * at.
 */
export const briefOf = (
  spec: RunSpec,
  settings: RepositorySettings,
  resume: Pause | null,
): Brief => {
  const { brief, execution } = spec;
  return {
    protocol: AGENT_PROTOCOL_VERSION,
    runId: spec.runId,
    taskId: spec.taskId,
    baseSha: spec.baseSha,
    model: execution.model,
    limits: {
      maxTurns: execution.maxTurns,
      timeoutMs: execution.timeoutMs,
      stallTimeoutMs: execution.stallTimeoutMs,
      budgetUsd: spec.credential === 'api-key' ? execution.budget.usd : null,
    },
    task: {
      title: brief.title,
      steps: brief.bundle.steps.map((step) => ({
        id: step.id,
        url: step.url,
        comment: step.comment,
        viewport: { width: step.viewport.width, height: step.viewport.height },
        files: [...step.files],
      })),
    },
    material: {
      entry: brief.bundle.entry,
      files: brief.bundle.files.map((file) => ({ path: file.path, mediaType: file.mediaType })),
    },
    exchanges: brief.exchanges.map((exchange) => ({
      question: {
        id: exchange.question.id,
        text: exchange.question.text,
        options: [...exchange.question.options],
      },
      answer: exchange.answer?.source === 'requester' ? { text: exchange.answer.text } : null,
    })),
    questionsLeft: brief.questionsLeft,
    resume,
    checks: [...settings.checks],
    policy: {
      protectedPaths: [...brief.protectedPaths],
      maxFiles: brief.limits.maxFiles,
      maxChangedLines: brief.limits.maxChangedLines,
    },
  };
};

/** A run asks at most one question, the one it ends with: its id is the run's. */
export const questionIdOf = (runId: RunId): QuestionId => QuestionId(`q-${runId}`);

/** What the runner stored of a run: its change bundle, and its paused session. */
export interface StoredOutputs {
  readonly change: BlobDigest | null;
  readonly session: Omit<Snapshot, 'questionId'> | null;
}

/** agent-host's outcome as the receiver's, with where the runner stored what the run left. */
export const runOutcomeOf = (runId: RunId, outcome: Outcome, stored: StoredOutputs): RunOutcome => {
  const { result } = outcome;
  const snapshot = (questionId: QuestionId | null): Snapshot | null =>
    stored.session === null ? null : { ...stored.session, questionId };
  const change = stored.change;
  switch (result.kind) {
    case 'change':
      return change === null
        ? {
            kind: 'failed',
            reason: 'infra',
            detail: 'The run reported a change but left no bundle',
            snapshot: null,
          }
        : {
            kind: 'change',
            change: { blob: change, head: result.head },
            report: {
              summary: result.report.summary,
              changes: result.report.changes.map((entry) => ({ file: entry.file, why: entry.why })),
              verification: result.report.verification,
              assumptions: [...result.report.assumptions],
            },
          };
    case 'no-change':
      return { kind: 'no-change', explanation: result.explanation };
    case 'question': {
      const id = questionIdOf(runId);
      return {
        kind: 'question',
        question: { id, text: result.question.text, options: [...result.question.options] },
        snapshot: snapshot(id),
      };
    }
    case 'quota-exhausted':
      return {
        kind: 'quota-exhausted',
        resetAt: Date.parse(result.resetAt),
        snapshot: snapshot(null),
      };
    case 'failed':
      return {
        kind: 'failed',
        reason: result.reason,
        detail: result.detail,
        snapshot: snapshot(null),
      };
  }
};
