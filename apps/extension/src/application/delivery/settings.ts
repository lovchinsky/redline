import {
  appError,
  err,
  formatBindingPattern,
  ok,
  parseBindingPattern,
  type AppError,
  type Binding,
  type Clock,
  type Logger,
  type Result,
} from '@redline/core';
import type { AppEvents, EventPublisher, ProjectRef, ReceiverView } from '@redline/rpc';
import type { BindingStore, ReceiverPort, SettingsStore } from '../../ports/delivery';
import type { TaskWriter } from '../tasks/task-writer';

type Done = Result<Record<string, never>, AppError>;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A receiver URL is https, or http on this machine; stored without a trailing slash. */
export const normalizeReceiverUrl = (text: string): Result<string, AppError> => {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return err(appError('validation', 'Not a URL'));
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure)
    return err(appError('validation', 'The receiver must use https (http only on localhost)'));
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    return err(
      appError('validation', 'The receiver URL must not carry a query, fragment or credentials'),
    );
  }
  return ok(`${url.origin}${url.pathname.replace(/\/+$/, '')}`);
};

export interface SettingsDeps {
  readonly settings: SettingsStore;
  readonly bindings: BindingStore;
  readonly receiver: ReceiverPort;
  /** Settings writes share the task write queue: submit reads bindings inside it. */
  readonly writer: TaskWriter;
  readonly events: EventPublisher<AppEvents>;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Receiver settings and site bindings, as the options page and the side panel manage them. */
export class ManageSettings {
  constructor(private readonly deps: SettingsDeps) {}

  async receiver(): Promise<Result<{ receiver: ReceiverView | null }, AppError>> {
    const stored = await this.deps.settings.receiver();
    if (!stored.ok) return stored;
    return ok({
      receiver:
        stored.value === null
          ? null
          : { baseUrl: stored.value.baseUrl, hasToken: stored.value.token !== null },
    });
  }

  /** `token` undefined keeps the stored token; `null` or empty removes it. */
  configureReceiver(baseUrl: string, token: string | null | undefined): Promise<Done> {
    return this.write(async () => {
      const url = normalizeReceiverUrl(baseUrl);
      if (!url.ok) return url;
      let nextToken = token === undefined ? null : token?.trim() || null;
      if (token === undefined) {
        const stored = await this.deps.settings.receiver();
        if (!stored.ok) return stored;
        nextToken = stored.value?.token ?? null;
      }
      return this.deps.settings.setReceiver({ baseUrl: url.value, token: nextToken });
    });
  }

  clearReceiver(): Promise<Done> {
    return this.write(() => this.deps.settings.setReceiver(null));
  }

  async projects(): Promise<Result<{ projects: readonly ProjectRef[] }, AppError>> {
    const projects = await this.deps.receiver.listProjects();
    return projects.ok ? ok({ projects: projects.value }) : projects;
  }

  async bindings(): Promise<Result<{ bindings: readonly Binding[] }, AppError>> {
    const bindings = await this.deps.bindings.all();
    return bindings.ok ? ok({ bindings: bindings.value }) : bindings;
  }

  async bind(pattern: string, project: ProjectRef): Promise<Result<{ pattern: string }, AppError>> {
    const parsed = parseBindingPattern(pattern);
    if (!parsed.ok) return parsed;
    const canonical = formatBindingPattern(parsed.value);
    const bound = await this.write(() =>
      this.deps.bindings.put({
        pattern: canonical,
        projectId: project.id,
        projectName: project.name,
        createdAt: this.deps.clock.now(),
      }),
    );
    return bound.ok ? ok({ pattern: canonical }) : bound;
  }

  unbind(pattern: string): Promise<Done> {
    return this.write(() => this.deps.bindings.remove(pattern));
  }

  private async write(change: () => Promise<Result<void, AppError>>): Promise<Done> {
    const result = await this.deps.writer.run(change);
    if (!result.ok) return result;
    const published = this.deps.events.publish('settings.changed', {});
    if (!published.ok)
      this.deps.logger.error('Could not publish settings.changed', { ...published.error });
    return ok({});
  }
}
