import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import {
  ERROR_CODES,
  IDEMPOTENCY_KEY_HEADER,
  MANIFEST_PART,
  PROJECT_PART,
  bundleManifestSchema,
  receiverRoutes,
  replyRequestSchema,
  type BundleManifest,
  type Project,
  type RemoteStatus,
  type TaskStateResponse,
} from '@redline/contract';

export interface MockTask {
  readonly remoteId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly manifest: BundleManifest;
  /** Every received file by bundle path, verified against the manifest hashes. */
  readonly files: ReadonlyMap<string, Buffer>;
  status: RemoteStatus;
  /** Statuses still to come; one is revealed on each status request. */
  readonly script: RemoteStatus[];
  readonly replies: { questionId: string; text: string }[];
}

export type Fault =
  /** Answers 503 with `Retry-After`, as an overloaded or restarting receiver would. */
  | 'unavailable'
  /** Accepts the task, then drops the connection before answering: a lost response. */
  | 'drop-after-accept';

export interface MockReceiverOptions {
  readonly port?: number;
  readonly token?: string;
  readonly projects?: readonly Project[];
  readonly pollAfterSec?: number;
  /** Statuses a new task goes through after `queued`. */
  readonly script?: () => RemoteStatus[];
}

export const DEFAULT_SCRIPT = (): RemoteStatus[] => [
  { phase: 'working' },
  {
    phase: 'needs-input',
    question: {
      id: 'q1',
      text: 'Should the change apply to every breakpoint?',
      options: ['Yes', 'Desktop only'],
    },
  },
  { phase: 'working' },
  { phase: 'result-ready', resultUrl: 'https://git.example/acme/web/pull/42' },
];

export interface MockReceiver {
  readonly url: string;
  readonly tasks: ReadonlyMap<string, MockTask>;
  /** How many `POST /v1/tasks` requests arrived, including repeats of the same key. */
  readonly submissions: () => number;
  /** The next `count` requests fail with `fault`. */
  fail(fault: Fault, count?: number): void;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The contract's error code; `request-failed` for errors it does not name. */
    readonly code: string = 'request-failed',
  ) {
    super(message);
  }
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

/** Stands for the remote id in route templates built from the contract's own routes. */
const ID = '\u0000id\u0000';

/**
 * Matches a path against a route of the contract (`receiverRoutes`), so the mock serves exactly
 * the paths the extension requests. Returns the decoded remote id ('' for routes without one),
 * or null when the path is not this route.
 */
const matchRoute = (template: string, path: string): string | null => {
  const [before, after] = template.split(encodeURIComponent(ID));
  if (after === undefined) return path === template ? '' : null;
  if (!path.startsWith(before ?? '') || !path.endsWith(after)) return null;
  const id = path.slice((before ?? '').length, path.length - after.length);
  return id === '' || id.includes('/') ? null : decodeURIComponent(id);
};

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const toRequest = (req: IncomingMessage, base: string): Request => {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  return new Request(new URL(req.url ?? '/', base), {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD'
      ? {}
      : { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' }),
  });
};

/**
 * A receiver that implements `receiver-api.v1` in memory, strictly: it validates every
 * manifest and file hash, honours `Idempotency-Key`, and can simulate faults. For e2e tests
 * and for trying the extension before a real receiver exists.
 */
export const startMockReceiver = async (
  options: MockReceiverOptions = {},
): Promise<MockReceiver> => {
  const projects = options.projects ?? [{ id: 'acme-web', name: 'Acme Web' }];
  const pollAfterSec = options.pollAfterSec ?? 1;
  const script = options.script ?? DEFAULT_SCRIPT;
  const tasks = new Map<string, MockTask>();
  const byKey = new Map<string, string>();
  const faults: Fault[] = [];
  let submissions = 0;

  const state = (task: MockTask): TaskStateResponse => ({
    remoteId: task.remoteId,
    status: task.status,
    pollAfterSec,
  });

  const taskOf = (remoteId: string): MockTask => {
    const task = tasks.get(remoteId);
    if (task === undefined) throw new HttpError(404, 'Unknown task', ERROR_CODES.unknownTask);
    return task;
  };

  const submit = async (request: Request): Promise<MockTask> => {
    const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
    if (key === null || key === '') throw new HttpError(400, 'Idempotency-Key is required');
    const existing = byKey.get(key);
    if (existing !== undefined) return taskOf(existing);

    const form = await request.formData();
    const manifestPart = form.get(MANIFEST_PART);
    if (!(manifestPart instanceof Blob)) throw new HttpError(400, 'manifest part is missing');
    const manifest = bundleManifestSchema.safeParse(JSON.parse(await manifestPart.text()));
    if (!manifest.success) throw new HttpError(422, `Invalid manifest: ${manifest.error.message}`);
    const projectId = form.get(PROJECT_PART);
    if (typeof projectId !== 'string' || !projects.some((project) => project.id === projectId)) {
      throw new HttpError(422, 'Unknown project');
    }

    const files = new Map<string, Buffer>();
    for (const listed of manifest.data.files) {
      const part = form.get(listed.path);
      if (!(part instanceof Blob)) throw new HttpError(422, `Missing file ${listed.path}`);
      const data = Buffer.from(await part.arrayBuffer());
      if (data.length !== listed.bytes || sha256(data) !== listed.sha256) {
        throw new HttpError(422, `File ${listed.path} does not match its hash`);
      }
      files.set(listed.path, data);
    }
    const extra = [...form.keys()].filter(
      (name) => name !== MANIFEST_PART && name !== PROJECT_PART && !files.has(name),
    );
    if (extra.length > 0) throw new HttpError(422, `Unlisted parts: ${extra.join(', ')}`);

    const remoteId = `remote-${String(tasks.size + 1)}`;
    const task: MockTask = {
      remoteId,
      idempotencyKey: key,
      projectId,
      manifest: manifest.data,
      files,
      status: { phase: 'queued' },
      script: script(),
      replies: [],
    };
    tasks.set(remoteId, task);
    byKey.set(key, remoteId);
    return task;
  };

  /** Reveals the next scripted status; a question waits for its answer. */
  const advance = (task: MockTask) => {
    if (task.status.phase === 'needs-input') return;
    const next = task.script.shift();
    if (next !== undefined) task.status = next;
  };

  const reply = async (task: MockTask, request: Request) => {
    const body = replyRequestSchema.safeParse(await request.json());
    if (!body.success) throw new HttpError(400, 'Invalid reply');
    const answered = task.replies.find((reply) => reply.questionId === body.data.questionId);
    // The same answer again (its response was lost): nothing changes.
    if (answered?.text === body.data.text) return;
    if (task.status.phase !== 'needs-input' || task.status.question.id !== body.data.questionId) {
      throw new HttpError(409, 'No such open question');
    }
    task.replies.push(body.data);
    task.status = task.script.shift() ?? { phase: 'working' };
  };

  const route = async (request: Request): Promise<unknown> => {
    const path = new URL(request.url).pathname;
    const at = (template: string) => matchRoute(template, path);
    if (request.method === 'GET' && at(receiverRoutes.listProjects()) !== null) {
      return { projects };
    }
    if (request.method === 'POST' && at(receiverRoutes.submitTask()) !== null) {
      return state(await submit(request));
    }
    const read = at(receiverRoutes.getTask(ID));
    if (request.method === 'GET' && read !== null) {
      const task = taskOf(read);
      advance(task);
      return state(task);
    }
    const replied = at(receiverRoutes.replyToTask(ID));
    if (request.method === 'POST' && replied !== null) {
      const task = taskOf(replied);
      await reply(task, request);
      return state(task);
    }
    throw new HttpError(404, 'Not found');
  };

  const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // A fresh connection per request: a dropped one is never silently retried by the
      // client's network stack (which it may do for a reused keep-alive socket).
      Connection: 'close',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': `Authorization, Content-Type, ${IDEMPOTENCY_KEY_HEADER}`,
        });
        res.end();
        return;
      }
      if (
        req.method === 'POST' &&
        matchRoute(receiverRoutes.submitTask(), new URL(req.url ?? '/', 'http://mock').pathname) !==
          null
      ) {
        submissions += 1;
      }
      const fault = faults.shift();
      if (fault === 'unavailable') {
        req.resume();
        send(res, 503, errorBody('unavailable', 'Unavailable'), { 'Retry-After': '1' });
        return;
      }
      if (options.token !== undefined && req.headers.authorization !== `Bearer ${options.token}`) {
        req.resume();
        send(res, 401, errorBody('unauthorized', 'Bad token'));
        return;
      }
      try {
        const body = await route(toRequest(req, 'http://mock.receiver'));
        if (fault === 'drop-after-accept') {
          res.destroy();
          return;
        }
        send(res, 200, body);
      } catch (cause) {
        if (cause instanceof HttpError) {
          send(res, cause.status, errorBody(cause.code, cause.message));
        } else send(res, 500, errorBody('internal', String(cause)));
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${String(port)}`,
    tasks,
    submissions: () => submissions,
    fail: (fault, count = 1) => {
      for (let i = 0; i < count; i += 1) faults.push(fault);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
};
