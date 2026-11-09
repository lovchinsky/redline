import {
  ERROR_CODES,
  IDEMPOTENCY_KEY_HEADER,
  errorResponseSchema,
  listProjectsResponseSchema,
  receiverRoutes,
  taskStateResponseSchema,
  type RemoteStatus,
  type TaskStateResponse,
} from '@redline/contract';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestFor, sampleFiles, submissionForm } from './bundle';

/** A receiver under test, running while the suite runs. */
export interface Target {
  readonly url: string;
  readonly token: string;
  /** A project the token's user may submit to. */
  readonly projectId: string;
  readonly stop: () => Promise<void>;
}

export interface SuiteOptions {
  /**
   * How long a task may take to move to its next phase. The mock moves on every status request;
   * a real receiver moves on its own.
   */
  readonly progressTimeoutMs: number;
}

/**
 * The obligations of `receiver-api.v1` that the extension relies on, checked against one
 * receiver. The mock receiver and the real one run the same suite, so the mock the extension's
 * end-to-end tests use cannot drift from what a real receiver does.
 */
export const describeConformance = (
  name: string,
  start: () => Promise<Target>,
  options: SuiteOptions,
) => {
  describe(`${name} conforms to receiver-api.v1`, () => {
    let target: Target;
    beforeAll(async () => {
      target = await start();
    });
    afterAll(async () => {
      await target.stop();
    });

    const call = (path: string, init: RequestInit = {}, token: string | null = target.token) => {
      const headers = new Headers(init.headers);
      if (token !== null) headers.set('Authorization', `Bearer ${token}`);
      return fetch(`${target.url}${path}`, { ...init, headers });
    };

    const submit = (key: string, form = submissionForm(target.projectId)) =>
      call(receiverRoutes.submitTask(), {
        method: 'POST',
        body: form,
        headers: key === '' ? {} : { [IDEMPOTENCY_KEY_HEADER]: key },
      });

    const state = async (response: Response): Promise<TaskStateResponse> => {
      expect(response.status).toBe(200);
      return taskStateResponseSchema.parse(await response.json());
    };

    const errorCode = async (response: Response) =>
      errorResponseSchema.safeParse(await response.json()).data?.error.code;

    /** Asks for the task's state until `done` holds for it. */
    const until = async (
      remoteId: string,
      done: (status: RemoteStatus) => boolean,
    ): Promise<RemoteStatus> => {
      const deadline = Date.now() + options.progressTimeoutMs;
      for (;;) {
        const { status } = await state(await call(receiverRoutes.getTask(remoteId)));
        if (done(status)) return status;
        if (Date.now() > deadline)
          throw new Error(`Still ${status.phase} after ${String(options.progressTimeoutMs)} ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    it('lists the projects of the token’s user', async () => {
      const response = await call(receiverRoutes.listProjects());
      expect(response.status).toBe(200);
      const listing = listProjectsResponseSchema.parse(await response.json());
      expect(listing.projects.map((project) => project.id)).toContain(target.projectId);
    });

    it('refuses a wrong token with 401', async () => {
      expect((await call(receiverRoutes.listProjects(), {}, 'not-a-token')).status).toBe(401);
    });

    it('takes a bundle once per idempotency key', async () => {
      const key = randomUUID();
      const first = await state(await submit(key));
      expect(first.pollAfterSec).toBeGreaterThan(0);
      const again = await state(await submit(key));
      expect(again.remoteId).toBe(first.remoteId);
      const other = await state(await submit(randomUUID()));
      expect(other.remoteId).not.toBe(first.remoteId);
    });

    it('refuses a submission without an idempotency key with 400', async () => {
      expect((await submit('')).status).toBe(400);
    });

    it('refuses a bundle whose file does not match its hash with 422', async () => {
      const files = sampleFiles();
      const tampered = { ...files, 'context.md': new TextEncoder().encode('something else') };
      const response = await submit(
        randomUUID(),
        submissionForm(target.projectId, tampered, manifestFor(files)),
      );
      expect(response.status).toBe(422);
    });

    it('answers a task it does not know with 404 unknown-task, and an unknown route without that code', async () => {
      const unknown = await call(receiverRoutes.getTask('no-such-task'));
      expect(unknown.status).toBe(404);
      expect(await errorCode(unknown)).toBe(ERROR_CODES.unknownTask);
      const route = await call('/v1/no-such-route');
      expect(route.status).toBe(404);
      expect(await errorCode(route)).not.toBe(ERROR_CODES.unknownTask);
    });

    it('asks a question, takes its answer once, and ends with a result page', async () => {
      const { remoteId } = await state(await submit(randomUUID()));
      const asked = await until(remoteId, (status) => status.phase === 'needs-input');
      if (asked.phase !== 'needs-input') throw new Error('No question');

      const reply = (questionId: string, text: string) =>
        call(receiverRoutes.replyToTask(remoteId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId, text }),
        });
      const answer = asked.question.options?.[0] ?? 'Yes';
      await state(await reply(asked.question.id, answer));
      // The same answer again (its response was lost) is harmless.
      await state(await reply(asked.question.id, answer));
      expect((await reply(asked.question.id, `${answer} and more`)).status).toBe(409);

      const result = await until(remoteId, (status) => status.phase === 'result-ready');
      if (result.phase !== 'result-ready') throw new Error('No result');
      expect(new URL(result.resultUrl).protocol).toMatch(/^https?:$/);
    });
  });
};
