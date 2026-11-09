import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Repositories under `root` over git's smart HTTP (`git http-backend`), answering only requests
 * that carry `authorization`, and keeping every `Authorization` header it saw.
 */
export const httpGitServer = async (root: string, authorization: string) => {
  const seen: (string | null)[] = [];
  const server: Server = createServer((request, response) => {
    const header = request.headers.authorization ?? null;
    seen.push(header);
    if (header !== authorization) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="git"' });
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://git');
    const backend = spawn('git', ['http-backend'], {
      env: {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: '1',
        REMOTE_USER: 'redline',
        REQUEST_METHOD: request.method ?? 'GET',
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: request.headers['content-encoding'] ?? '',
        GIT_PROTOCOL: String(request.headers['git-protocol'] ?? ''),
      },
    });
    request.pipe(backend.stdin);
    const chunks: Buffer[] = [];
    backend.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    backend.on('close', () => {
      const output = Buffer.concat(chunks);
      const split = output.indexOf('\r\n\r\n');
      const head = output.subarray(0, split).toString('utf8');
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head.split('\r\n')) {
        const colon = line.indexOf(':');
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name === 'status') status = Number(value.split(' ')[0]);
        else if (name !== '') headers[name] = value;
      }
      response.writeHead(status, headers);
      response.end(output.subarray(split + 4));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}`, seen, close: () => server.close() };
};
