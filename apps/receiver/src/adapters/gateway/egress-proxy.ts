import { lookup } from 'node:dns/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { isPublicAddress } from '../../domain/egress';
import type { EgressAccess } from '../../ports/gateway';
import type { Logger } from '../../ports/system';

/**
 * The setup sandbox's grant, from the proxy credentials package managers send:
 * `http://redline:<grant>@egress:3128` arrives as Basic, the password being the grant.
 */
export const proxyGrantOf = (request: IncomingMessage): string | null => {
  const header = request.headers['proxy-authorization'] ?? '';
  const basic = /^Basic\s+(\S+)$/i.exec(header);
  if (basic?.[1] !== undefined) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    return colon < 0 ? null : decoded.slice(colon + 1) || null;
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(header);
  return bearer?.[1] ?? null;
};

const refuse = (socket: Duplex, status: number, reason: string) => {
  socket.end(
    `HTTP/1.1 ${String(status)} ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );
};

/** `host:port` of a CONNECT request; IPv6 hosts in brackets. */
const targetOf = (authority: string): { host: string; port: number } | null => {
  const match = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(authority);
  const host = match?.[1] ?? match?.[2];
  const port = Number(match?.[3]);
  return host === undefined || !Number.isInteger(port) ? null : { host, port };
};

export interface EgressProxyOptions {
  readonly access: EgressAccess;
  readonly logger: Logger;
  /** Every address a name resolves to. */
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly open?: (address: string, port: number) => Socket;
}

/**
 * The gateway's egress towards package registries: HTTP CONNECT tunnels only, to a host the
 * setup grant lists, at an address on the public internet. The gateway resolves names: the
 * sandbox has no resolver, and a name that resolves to any address inside the deployment is
 * refused outright.
 */
export const createEgressProxy = (options: EgressProxyOptions): Server => {
  const resolve =
    options.resolve ??
    (async (host: string) =>
      (await lookup(host, { all: true, order: 'verbatim' })).map((entry) => entry.address));
  const open =
    options.open ?? ((address: string, port: number) => connect({ host: address, port }));

  const server = createServer((_request, response) => {
    response.writeHead(405, { allow: 'CONNECT', 'content-length': 0 });
    response.end();
  });

  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    client.on('error', () => client.destroy());
    const target = targetOf(request.url ?? '');
    if (target === null) {
      refuse(client, 400, 'Bad Request');
      return;
    }
    void (async () => {
      const decision = await options.access.authorize(
        proxyGrantOf(request),
        target.host,
        target.port,
      );
      if (!decision.ok) {
        refuse(client, 403, 'Forbidden');
        return;
      }
      let addresses: readonly string[];
      try {
        addresses = await resolve(target.host);
      } catch {
        refuse(client, 502, 'Bad Gateway');
        return;
      }
      if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
        options.logger.warn('Refused a host that resolves inside the deployment', {
          runId: decision.runId,
          host: target.host,
        });
        refuse(client, 403, 'Forbidden');
        return;
      }
      const upstream = open(addresses[0] ?? '', target.port);
      upstream.once('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.byteLength > 0) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => {
        if (upstream.connecting) refuse(client, 502, 'Bad Gateway');
        else client.destroy();
      });
      client.on('close', () => upstream.destroy());
    })().catch((error: unknown) => {
      options.logger.error('The egress proxy failed a tunnel', { error: String(error) });
      client.destroy();
    });
  });
  return server;
};
