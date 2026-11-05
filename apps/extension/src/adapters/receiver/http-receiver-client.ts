import {
  IDEMPOTENCY_KEY_HEADER,
  MANIFEST_PART,
  PROJECT_PART,
  listProjectsResponseSchema,
  receiverRoutes,
  taskStateResponseSchema,
} from '@redline/contract';
import { ProjectId, appError, err, ok, parseWith, type AppError, type Result } from '@redline/core';
import type * as z from 'zod/mini';
import type {
  Delivery,
  ReceiverPort,
  ReceiverProject,
  ReceiverReport,
  ReceiverSettings,
  SettingsStore,
} from '../../ports/delivery';

const REQUEST_TIMEOUT_MS = 30_000;

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** Seconds from a `Retry-After` header (delta-seconds or an HTTP date), if present. */
const retryAfterSec = (response: Response, now: number): number | undefined => {
  const header = response.headers.get('Retry-After');
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
};

/** HTTP status → application error; transient failures are `receiver-unavailable`. */
const httpError = (response: Response, now: number): AppError => {
  const details = { status: response.status, retryAfterSec: retryAfterSec(response, now) };
  const { status } = response;
  if (status === 401 || status === 403) {
    return appError('permission-denied', 'The receiver refused the access token', {
      ...details,
      reason: 'token-refused',
    });
  }
  if (status === 404) return appError('not-found', 'The receiver does not know this', details);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return appError(
      'receiver-unavailable',
      `The receiver is unavailable (${String(status)})`,
      details,
    );
  }
  return appError('validation', `The receiver rejected the request (${String(status)})`, details);
};

/**
 * `receiver-api.v1` over HTTP. Reads the settings on every call, so a changed URL or token
 * applies at once. Bundles go as multipart: the manifest, then every file under its path.
 */
export class HttpReceiverClient implements ReceiverPort {
  constructor(
    private readonly settings: SettingsStore,
    private readonly fetch: Fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async listProjects(): Promise<Result<readonly ReceiverProject[], AppError>> {
    const response = await this.request(receiverRoutes.listProjects(), { method: 'GET' });
    const body = await this.parse(response, listProjectsResponseSchema);
    return body.ok
      ? ok(
          body.value.projects.map((project) => ({
            id: ProjectId.parse(project.id),
            name: project.name,
          })),
        )
      : body;
  }

  async submit(delivery: Delivery): Promise<Result<ReceiverReport, AppError>> {
    const form = new FormData();
    form.append(
      MANIFEST_PART,
      new Blob([JSON.stringify(delivery.bundle.manifest)], { type: 'application/json' }),
      'manifest.json',
    );
    form.append(PROJECT_PART, delivery.projectId);
    for (const [path, blob] of delivery.bundle.files) form.append(path, blob, path);

    const response = await this.request(receiverRoutes.submitTask(), {
      method: 'POST',
      headers: { [IDEMPOTENCY_KEY_HEADER]: delivery.idempotencyKey },
      body: form,
    });
    return this.parse(response, taskStateResponseSchema);
  }

  async getTask(remoteId: string): Promise<Result<ReceiverReport, AppError>> {
    const response = await this.request(receiverRoutes.getTask(remoteId), { method: 'GET' });
    return this.parse(response, taskStateResponseSchema);
  }

  async reply(
    remoteId: string,
    answer: { readonly questionId: string; readonly text: string },
  ): Promise<Result<ReceiverReport, AppError>> {
    const response = await this.request(receiverRoutes.replyToTask(remoteId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answer),
    });
    return this.parse(response, taskStateResponseSchema);
  }

  private async request(path: string, init: RequestInit): Promise<Result<Response, AppError>> {
    const settings = await this.settings.receiver();
    if (!settings.ok) return settings;
    if (settings.value === null) {
      return err(appError('not-configured', 'No receiver is configured'));
    }
    const { baseUrl, token }: ReceiverSettings = settings.value;
    const headers = new Headers(init.headers);
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);
    try {
      const response = await this.fetch(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok ? ok(response) : err(httpError(response, this.now()));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'TimeoutError') {
        return err(appError('timeout', 'The receiver did not answer in time'));
      }
      return err(
        appError('receiver-unavailable', 'The receiver is not reachable', {
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }

  private async parse<S extends z.ZodMiniType>(
    response: Result<Response, AppError>,
    schema: S,
  ): Promise<Result<z.output<S>, AppError>> {
    if (!response.ok) return response;
    let body: unknown;
    try {
      body = await response.value.json();
    } catch {
      return err(appError('receiver-unavailable', 'The receiver sent a response that is not JSON'));
    }
    const parsed = parseWith(schema, body);
    return parsed.ok
      ? parsed
      : err(
          appError('receiver-unavailable', 'The receiver broke the protocol', {
            ...parsed.error.details,
          }),
        );
  }
}
