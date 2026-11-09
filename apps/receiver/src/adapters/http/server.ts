import multipart from '@fastify/multipart';
import {
  ERROR_CODES,
  IDEMPOTENCY_KEY_HEADER,
  MODEL_CREDENTIAL_HEADER,
  MODEL_CREDENTIAL_KINDS,
  MODEL_CREDENTIAL_KIND_HEADER,
  receiverRouteTemplates,
  replyRequestSchema,
  type ListProjectsResponse,
} from '@redline/contract';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ProjectId, QuestionId, TaskId } from '../../domain/ids';
import type { Task } from '../../domain/task';
import { ModelCredential, type Identity, type User } from '../../ports/access';
import type { BlobStore } from '../../ports/bundles';
import type { RequestError, Requests } from '../../ports/requests';
import type { Clock, Logger } from '../../ports/system';
import { receiveBundle, type IntakeLimits } from './intake';
import { present } from './presenter';
import { SubmissionLimiter } from './submission-limiter';

export interface ApiDeps {
  readonly requests: Requests;
  readonly identity: Identity;
  readonly blobs: BlobStore;
  readonly intake: IntakeLimits & { readonly submissionsPerMinute: number };
  readonly clock: Clock;
  readonly logger: Logger;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

/** A refusal in the contract's shape: the extension acts on `code`, people read `message`. */
const refuse = (
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) => reply.code(status).headers(headers).send({ error: { code, message } });

const STATUS_OF: Record<RequestError['code'], number> = {
  'not-found': 404,
  conflict: 409,
  invalid: 422,
};
const CODE_OF: Record<RequestError['code'], string> = {
  'not-found': ERROR_CODES.unknownTask,
  conflict: 'conflict',
  invalid: 'invalid-request',
};

const respond = (
  reply: FastifyReply,
  result: { ok: true; value: Task } | { ok: false; error: RequestError },
) =>
  result.ok
    ? reply.send(present(result.value))
    : refuse(reply, STATUS_OF[result.error.code], CODE_OF[result.error.code], result.error.message);

type CredentialHeader =
  { ok: true; credential: ModelCredential | null } | { ok: false; message: string };

/** The requester's model credential from the request's headers, if it brought one. */
const credentialOf = (request: FastifyRequest): CredentialHeader => {
  const secret = request.headers[MODEL_CREDENTIAL_HEADER.toLowerCase()];
  const kind = request.headers[MODEL_CREDENTIAL_KIND_HEADER.toLowerCase()];
  if (secret === undefined && kind === undefined) return { ok: true, credential: null };
  if (typeof secret !== 'string' || secret === '' || typeof kind !== 'string') {
    return {
      ok: false,
      message: `${MODEL_CREDENTIAL_HEADER} needs ${MODEL_CREDENTIAL_KIND_HEADER}, and the other way round`,
    };
  }
  const known = MODEL_CREDENTIAL_KINDS.find((candidate) => candidate === kind);
  if (known === undefined)
    return { ok: false, message: `Unknown ${MODEL_CREDENTIAL_KIND_HEADER}: ${kind}` };
  return { ok: true, credential: new ModelCredential(known, secret) };
};

const bearerOf = (request: FastifyRequest): string | null => {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
};

/**
 * `receiver-api.v1` over HTTP. No CORS: the extension calls with host permissions, and nothing
 * else should call at all. The request log carries no headers, so no credential reaches it.
 */
export const buildApi = async (deps: ApiDeps): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, trustProxy: true });
  const limiter = new SubmissionLimiter(deps.intake.submissionsPerMinute, deps.clock);

  await app.register(multipart, {
    limits: {
      fileSize: deps.intake.bundleBytes * 2,
      files: deps.intake.files + 1,
      fields: 4,
      parts: deps.intake.files + 5,
      fieldSize: 1024,
    },
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/healthz') return;
    const token = bearerOf(request);
    const user = token === null ? null : await deps.identity.authenticate(token);
    if (user === null)
      return refuse(reply, 401, 'unauthorized', 'A valid access token is required');
    request.user = user;
  });
  app.addHook('onResponse', async (request, reply) => {
    deps.logger.info('Request', {
      method: request.method,
      route: request.routeOptions.url,
      status: reply.statusCode,
      user: request.user?.id,
      ms: Math.round(reply.elapsedTime),
    });
  });
  app.setErrorHandler(async (error: Error & { statusCode?: number }, request, reply) => {
    if (error.statusCode === 413) {
      reply.header('Connection', 'close');
      return refuse(reply, 413, 'too-large', 'The bundle is too large');
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return refuse(reply, 400, 'invalid-request', error.message);
    }
    deps.logger.error('Request failed', { route: request.routeOptions.url, error: error.message });
    return refuse(reply, 503, 'unavailable', 'The receiver could not handle the request', {
      'Retry-After': '30',
    });
  });

  const userOf = (request: FastifyRequest): User => {
    if (request.user === null) throw new Error('An unauthenticated request reached a route');
    return request.user;
  };

  // Not the API: a bare 404, which the extension reads as a wrong address, not a lost task.
  app.setNotFoundHandler(async (_request, reply) =>
    refuse(reply, 404, 'no-route', 'No such route'),
  );

  app.get('/healthz', () => ({ ok: true }));

  app.get(receiverRouteTemplates.listProjects, (request): ListProjectsResponse => {
    const listing = deps.requests.listProjects(userOf(request));
    return {
      projects: listing.projects.map(({ id, name }) => ({ id, name })),
      modelCredential: listing.modelCredential,
    };
  });

  app.post(receiverRouteTemplates.submitTask, async (request, reply) => {
    const user = userOf(request);
    const key = request.headers[IDEMPOTENCY_KEY_HEADER.toLowerCase()];
    if (typeof key !== 'string' || key === '') {
      return refuse(reply, 400, 'invalid-request', `${IDEMPOTENCY_KEY_HEADER} is required`);
    }
    const credential = credentialOf(request);
    if (!credential.ok) return refuse(reply, 400, 'invalid-request', credential.message);

    const existing = await deps.requests.findSubmitted(user, key, credential.credential);
    if (existing !== null) {
      // A repeat of a submission already taken: its body is not needed, but is read off the wire.
      for await (const part of request.parts()) if (part.type === 'file') part.file.resume();
      return reply.send(present(existing));
    }
    const retryAfter = limiter.take(user.id);
    if (retryAfter !== null) {
      for await (const part of request.parts()) if (part.type === 'file') part.file.resume();
      return refuse(reply, 429, 'rate-limited', 'Too many submissions', {
        'Retry-After': String(retryAfter),
      });
    }

    const received = await receiveBundle(request.parts(), deps.blobs, deps.intake);
    if (!received.ok) return refuse(reply, received.status, received.code, received.message);
    return respond(
      reply,
      await deps.requests.submit({
        requester: user,
        idempotencyKey: key,
        projectId: ProjectId(received.projectId),
        manifest: received.manifest,
        credential: credential.credential,
      }),
    );
  });

  app.get<{ Params: { remoteId: string } }>(
    receiverRouteTemplates.getTask,
    async (request, reply) => {
      const credential = credentialOf(request);
      if (!credential.ok) return refuse(reply, 400, 'invalid-request', credential.message);
      return respond(
        reply,
        await deps.requests.state(
          userOf(request),
          TaskId(request.params.remoteId),
          credential.credential,
        ),
      );
    },
  );

  app.post<{ Params: { remoteId: string } }>(
    receiverRouteTemplates.replyToTask,
    async (request, reply) => {
      const credential = credentialOf(request);
      if (!credential.ok) return refuse(reply, 400, 'invalid-request', credential.message);
      const body = replyRequestSchema.safeParse(request.body);
      if (!body.success)
        return refuse(reply, 400, 'invalid-request', 'The reply needs questionId and text');
      return respond(
        reply,
        await deps.requests.reply(
          userOf(request),
          TaskId(request.params.remoteId),
          { questionId: QuestionId(body.data.questionId), text: body.data.text },
          credential.credential,
        ),
      );
    },
  );

  return app;
};
