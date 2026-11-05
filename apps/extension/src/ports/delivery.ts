/** Ports the delivery use cases need from the platform. Implemented in adapters. */
import type { Bundle } from '@redline/assembly';
import type { AppError, Binding, ProjectId, RemoteReport, Result, TaskId } from '@redline/core';

export interface ReceiverProject {
  readonly id: ProjectId;
  readonly name: string;
}

/** What the receiver says about one task. */
export interface ReceiverReport extends RemoteReport {
  readonly remoteId: string;
}

export interface Delivery {
  readonly projectId: ProjectId;
  readonly bundle: Bundle;
  /** Same key → same remote task: a retry after a lost response never creates a duplicate. */
  readonly idempotencyKey: TaskId;
}

/** The service that turns bundles into code changes. Knows nothing about GitHub here. */
export interface ReceiverPort {
  listProjects(): Promise<Result<readonly ReceiverProject[], AppError>>;
  submit(delivery: Delivery): Promise<Result<ReceiverReport, AppError>>;
  getTask(remoteId: string): Promise<Result<ReceiverReport, AppError>>;
  reply(
    remoteId: string,
    answer: { readonly questionId: string; readonly text: string },
  ): Promise<Result<ReceiverReport, AppError>>;
}

export interface ReceiverSettings {
  /** https, or http on localhost; no trailing slash. */
  readonly baseUrl: string;
  readonly token: string | null;
}

export interface SettingsStore {
  receiver(): Promise<Result<ReceiverSettings | null, AppError>>;
  setReceiver(settings: ReceiverSettings | null): Promise<Result<void, AppError>>;
}

export interface BindingStore {
  all(): Promise<Result<readonly Binding[], AppError>>;
  /** Adds or replaces the binding with the same pattern. */
  put(binding: Binding): Promise<Result<void, AppError>>;
  remove(pattern: string): Promise<Result<void, AppError>>;
}

/** Background work the service worker must come back to, surviving its own shutdown. */
export type WakeUpReason = 'deliver' | 'check-statuses';

export interface WakeUps {
  /** Wakes the worker at `time` (replacing the previous one), or cancels it with `null`. */
  schedule(reason: WakeUpReason, time: number | null): Promise<void>;
}

/** The toolbar summary of tasks in flight. */
export interface ActivityIndicator {
  show(activity: { readonly active: number; readonly needsInput: number }): Promise<void>;
}

/** Something about a task the user should hear about while looking elsewhere. */
export type TaskNotice = { readonly taskId: TaskId; readonly taskTitle: string } & (
  | { readonly kind: 'needs-input'; readonly question: string }
  | { readonly kind: 'result-ready'; readonly resultUrl: string }
  | { readonly kind: 'remote-failed'; readonly reason: string }
  | { readonly kind: 'delivery-failed'; readonly reason: string }
);

/** Tells the user about a task outside the page; the adapter owns the wording. */
export interface Notifier {
  notify(notice: TaskNotice): Promise<void>;
}

/** Optional host access, asked of the user one site at a time. Call within a user gesture. */
export interface HostAccess {
  /** Resolves `true` if every pattern is (now) granted. */
  request(matchPatterns: readonly string[]): Promise<boolean>;
}

/** Leaving the current page: settings, a result link. */
export interface Navigation {
  openSettings(): Promise<void>;
  openUrl(url: string): Promise<void>;
}
