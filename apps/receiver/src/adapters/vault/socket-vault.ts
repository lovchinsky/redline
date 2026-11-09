import { chmod, rm } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import * as z from 'zod/mini';
import type { CredentialKind } from '../../domain/grant';
import { TaskId } from '../../domain/ids';
import { ModelCredential, type CredentialVault } from '../../ports/access';

/**
 * The vault across processes: the gateway holds the credentials in its memory and serves them
 * on a unix socket that only the receiver's own services share (a volume, never a network the
 * sandboxes are on). The API deposits what the extension sends; the worker asks what is held.
 */
const PATH = /^\/v1\/credentials\/([A-Za-z0-9_-]{1,128})$/;
const depositSchema = z.object({
  kind: z.enum(['api-key', 'subscription']),
  secret: z.string().check(z.minLength(1)),
});
const heldSchema = z.object({ kind: z.enum(['api-key', 'subscription']) });

/** Serves `vault` on `socketPath`, readable and writable by the owner and its group only. */
export const serveVault = async (vault: CredentialVault, socketPath: string): Promise<Server> => {
  const server = createServer((request, response) => {
    const match = PATH.exec(request.url ?? '');
    const send = (status: number, body?: unknown) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      response.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(text),
      });
      response.end(text);
    };
    if (match?.[1] === undefined) {
      send(404);
      return;
    }
    const taskId = TaskId(match[1]);
    void (async () => {
      switch (request.method) {
        case 'PUT': {
          const chunks: Buffer[] = [];
          for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk);
          let raw: unknown;
          try {
            raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            raw = null;
          }
          const parsed = depositSchema.safeParse(raw);
          if (!parsed.success) {
            send(400);
            return;
          }
          await vault.deposit(taskId, new ModelCredential(parsed.data.kind, parsed.data.secret));
          send(204);
          return;
        }
        case 'GET': {
          const kind = await vault.held(taskId);
          if (kind === null) send(404);
          else send(200, { kind });
          return;
        }
        case 'DELETE':
          await vault.forget(taskId);
          send(204);
          return;
        default:
          send(405);
      }
    })().catch(() => {
      send(500);
    });
  });
  await rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  await chmod(socketPath, 0o660);
  return server;
};

/** The vault of the gateway, from the API's and the worker's side of its socket. */
export class SocketVault implements CredentialVault {
  constructor(private readonly socketPath: string) {}

  async deposit(taskId: TaskId, credential: ModelCredential): Promise<void> {
    const { status } = await this.call('PUT', taskId, {
      kind: credential.kind,
      secret: credential.reveal(),
    });
    if (status !== 204) throw new Error(`The gateway refused a credential (${String(status)})`);
  }

  async held(taskId: TaskId): Promise<CredentialKind | null> {
    const { status, body } = await this.call('GET', taskId);
    if (status === 404) return null;
    const parsed = heldSchema.safeParse(body);
    if (status !== 200 || !parsed.success)
      throw new Error(`The gateway's vault answered ${String(status)}`);
    return parsed.data.kind;
  }

  async forget(taskId: TaskId): Promise<void> {
    const { status } = await this.call('DELETE', taskId);
    if (status !== 204) throw new Error(`The gateway's vault answered ${String(status)}`);
  }

  private call(method: string, taskId: TaskId, payload?: unknown) {
    return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const text = payload === undefined ? undefined : JSON.stringify(payload);
      const outgoing = httpRequest(
        {
          socketPath: this.socketPath,
          path: `/v1/credentials/${encodeURIComponent(taskId)}`,
          method,
          headers:
            text === undefined
              ? {}
              : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
          timeout: 10_000,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body: unknown;
            try {
              body = raw === '' ? null : JSON.parse(raw);
            } catch {
              body = null;
            }
            resolve({ status: incoming.statusCode ?? 0, body });
          });
          incoming.on('error', reject);
        },
      );
      outgoing.on('timeout', () =>
        outgoing.destroy(new Error('The gateway’s vault did not answer')),
      );
      outgoing.on('error', reject);
      outgoing.end(text);
    });
  }
}
