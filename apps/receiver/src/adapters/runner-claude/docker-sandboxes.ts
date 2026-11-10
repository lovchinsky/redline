import { request as httpRequest, type IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import type { ContainerSpec, ContainerState, SandboxProvider } from './sandbox';
import { insideRoot } from './tar';

/** The Engine API version spoken: Docker 25 and later. */
const API = '/v1.44';

interface Answer {
  readonly status: number;
  readonly body: Buffer;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const json = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
};

const failure = (what: string, answer: Answer) =>
  new Error(
    `Docker could not ${what} (${String(answer.status)}): ${answer.body.toString('utf8').trim()}`,
  );

/** Container output as the Engine sends it without a TTY: frames of 8-byte headers. */
const demultiplex = (body: Buffer): string => {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= body.length) {
    const size = body.readUInt32BE(offset + 4);
    parts.push(body.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  return Buffer.concat(parts).toString('utf8');
};

/** A time Docker reports, in milliseconds since the epoch; one it does not know is an error. */
const instantOf = (value: unknown): number => {
  const instant = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(instant)) throw new Error(`Docker reported no time: ${String(value)}`);
  return instant;
};

export interface DockerOptions {
  readonly socketPath: string;
  /**
   * The OCI runtime sandboxes run under: `runsc` (gVisor), `runc` when isolation is waived, or
   * `auto`: gVisor where Docker has it, runc where it has not.
   */
  readonly runtime: 'runsc' | 'runc' | 'auto';
}

/**
 * Sandboxes as Docker containers, through the Engine API on its socket. Each runs under the
 * configured runtime, unprivileged and without capabilities, on a read-only root with a
 * scratch `/tmp`, with limits on CPU, memory and processes, and without a resolver.
 */
export class DockerSandboxes implements SandboxProvider {
  /** The runtime `auto` settled on, once Docker said which it has. */
  private settled: 'runsc' | 'runc' | null;

  constructor(private readonly options: DockerOptions) {
    this.settled = options.runtime === 'auto' ? null : options.runtime;
  }

  /** The runtimes Docker has, or null when it cannot be asked. */
  private async runtimes(): Promise<readonly string[] | null> {
    const info = await this.call('GET', '/info');
    if (info.status !== 200) return null;
    const parsed = json(info.body);
    return isRecord(parsed) && isRecord(parsed['Runtimes']) ? Object.keys(parsed['Runtimes']) : [];
  }

  /** The runtime sandboxes run under: with `auto`, decided by asking Docker once. */
  async isolation(): Promise<'runsc' | 'runc'> {
    if (this.settled !== null) return this.settled;
    const runtimes = await this.runtimes();
    if (runtimes === null) throw new Error('Docker is not reachable');
    this.settled = runtimes.includes('runsc') ? 'runsc' : 'runc';
    return this.settled;
  }

  async unfit(networks: readonly string[]): Promise<string | null> {
    const runtimes = await this.runtimes();
    if (runtimes === null) return 'Docker is not reachable';
    const runtime = await this.isolation();
    if (!runtimes.includes(runtime)) {
      return `Docker has no ${runtime} runtime: sandboxes cannot be isolated as configured`;
    }
    for (const network of networks) {
      if (network === 'none') continue;
      const answer = await this.call('GET', `/networks/${encodeURIComponent(network)}`);
      const inspected = json(answer.body);
      if (answer.status !== 200) return `The sandbox network ${network} does not exist`;
      if (!isRecord(inspected) || inspected['Internal'] !== true) {
        return `The sandbox network ${network} is not internal: it would reach the internet`;
      }
    }
    return null;
  }

  /** The image's id when Docker has it: sandboxes start from it, never by pulling it. */
  async imageId(reference: string): Promise<string | null> {
    const answer = await this.call('GET', `/images/${encodeURIComponent(reference)}/json`);
    if (answer.status === 404) return null;
    const inspected = json(answer.body);
    if (answer.status !== 200 || !isRecord(inspected) || typeof inspected['Id'] !== 'string')
      throw failure(`inspect the image ${reference}`, answer);
    return inspected['Id'];
  }

  async createVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void> {
    const answer = await this.call('POST', '/volumes/create', { Name: name, Labels: labels });
    if (answer.status !== 201 && answer.status !== 200)
      throw failure(`create volume ${name}`, answer);
  }

  async removeVolume(name: string): Promise<void> {
    const answer = await this.call('DELETE', `/volumes/${encodeURIComponent(name)}?force=true`);
    if (answer.status !== 204 && answer.status !== 404)
      throw failure(`remove volume ${name}`, answer);
  }

  async create(spec: ContainerSpec): Promise<void> {
    const networked = spec.network !== 'none';
    const answer = await this.call(
      'POST',
      `/containers/create?name=${encodeURIComponent(spec.name)}`,
      {
        Image: spec.image,
        // A phase's own command replaces the image's entrypoint, not just its arguments.
        ...(spec.command === null ? {} : { Entrypoint: spec.command, Cmd: [] }),
        Env: Object.entries(spec.env).map(([name, value]) => `${name}=${value}`),
        WorkingDir: spec.workdir,
        User: `${String(spec.user.uid)}:${String(spec.user.gid)}`,
        Labels: spec.labels,
        HostConfig: {
          Runtime: await this.isolation(),
          Init: true,
          Mounts: spec.mounts.map((mount) => ({
            Type: 'volume',
            Source: mount.volume,
            Target: mount.target,
            ReadOnly: mount.readOnly,
          })),
          NetworkMode: spec.network,
          // The sandbox resolves no names: the gateway's addresses are given, nothing else is reachable.
          ...(networked ? { Dns: ['127.0.0.1'], DnsSearch: [], DnsOptions: [] } : {}),
          ReadonlyRootfs: true,
          Tmpfs: { '/tmp': 'rw,nosuid,nodev,size=2g' },
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          Privileged: false,
          NanoCpus: Math.round(spec.limits.cpus * 1e9),
          Memory: spec.limits.memoryBytes,
          MemorySwap: spec.limits.memoryBytes,
          PidsLimit: spec.limits.pids,
        },
      },
    );
    if (answer.status !== 201 && answer.status !== 409)
      throw failure(`create ${spec.name}`, answer);
  }

  async upload(container: string, path: string, archive: Buffer | Readable): Promise<void> {
    const answer = await this.call(
      'PUT',
      `/containers/${encodeURIComponent(container)}/archive?path=${encodeURIComponent(path)}`,
      archive,
    );
    if (answer.status !== 200) throw failure(`copy into ${container}`, answer);
  }

  async download(container: string, path: string): Promise<Readable | null> {
    const response = await this.stream(
      'GET',
      `/containers/${encodeURIComponent(container)}/archive?path=${encodeURIComponent(path)}`,
    );
    if (response.statusCode === 404) {
      response.resume();
      return null;
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new Error(`Docker could not copy out of ${container} (${String(response.statusCode)})`);
    }
    // Docker puts the directory itself at the archive's root.
    return insideRoot(response);
  }

  async start(container: string): Promise<void> {
    const answer = await this.call('POST', `/containers/${encodeURIComponent(container)}/start`);
    if (answer.status !== 204 && answer.status !== 304) throw failure(`start ${container}`, answer);
  }

  async state(container: string): Promise<ContainerState> {
    const answer = await this.call('GET', `/containers/${encodeURIComponent(container)}/json`);
    if (answer.status === 404) return { status: 'missing' };
    const parsed = json(answer.body);
    const state = isRecord(parsed) && isRecord(parsed['State']) ? parsed['State'] : null;
    if (answer.status !== 200 || state === null) throw failure(`inspect ${container}`, answer);
    const config = isRecord(parsed) && isRecord(parsed['Config']) ? parsed['Config'] : {};
    const raw = isRecord(config['Labels']) ? config['Labels'] : {};
    const labels = Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const startedAt = instantOf(state['StartedAt']);
    switch (state['Status']) {
      case 'created':
        return { status: 'created', labels };
      case 'exited':
      case 'dead':
        return {
          status: 'exited',
          labels,
          exitCode: Number(state['ExitCode'] ?? 1),
          startedAt,
          finishedAt: instantOf(state['FinishedAt']),
        };
      default:
        return { status: 'running', labels, startedAt };
    }
  }

  async wait(container: string, signal: AbortSignal): Promise<number | null> {
    if (signal.aborted) return null;
    const controller = new AbortController();
    const abort = () => {
      controller.abort();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const answer = await this.call(
        'POST',
        `/containers/${encodeURIComponent(container)}/wait?condition=not-running`,
        undefined,
        controller.signal,
      );
      const parsed = json(answer.body);
      if (answer.status !== 200 || !isRecord(parsed))
        throw failure(`wait for ${container}`, answer);
      return Number(parsed['StatusCode'] ?? 1);
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  async logs(container: string, lines: number): Promise<string> {
    const answer = await this.call(
      'GET',
      `/containers/${encodeURIComponent(container)}/logs?stdout=1&stderr=1&tail=${String(lines)}`,
    );
    return answer.status === 200 ? demultiplex(answer.body) : '';
  }

  async kill(container: string): Promise<void> {
    const answer = await this.call('POST', `/containers/${encodeURIComponent(container)}/kill`);
    // 404: it is gone; 409: it is not running.
    if (answer.status !== 204 && answer.status !== 404 && answer.status !== 409)
      throw failure(`kill ${container}`, answer);
  }

  async remove(container: string): Promise<void> {
    const answer = await this.call(
      'DELETE',
      `/containers/${encodeURIComponent(container)}?force=true`,
    );
    if (answer.status !== 204 && answer.status !== 404)
      throw failure(`remove ${container}`, answer);
  }

  async labelled(
    label: string,
  ): Promise<readonly { readonly name: string; readonly value: string }[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
    const containers = json(
      (await this.call('GET', `/containers/json?all=true&filters=${filters}`)).body,
    );
    const volumes = json((await this.call('GET', `/volumes?filters=${filters}`)).body);
    const found: { name: string; value: string }[] = [];
    for (const item of Array.isArray(containers) ? containers : []) {
      if (!isRecord(item)) continue;
      const names = Array.isArray(item['Names']) ? item['Names'] : [];
      const labels = isRecord(item['Labels']) ? item['Labels'] : {};
      const name = typeof names[0] === 'string' ? names[0].replace(/^\//, '') : null;
      const value = labels[label];
      if (name !== null && typeof value === 'string') found.push({ name, value });
    }
    const listed = isRecord(volumes) && Array.isArray(volumes['Volumes']) ? volumes['Volumes'] : [];
    for (const item of listed) {
      if (!isRecord(item)) continue;
      const labels = isRecord(item['Labels']) ? item['Labels'] : {};
      const value = labels[label];
      if (typeof item['Name'] === 'string' && typeof value === 'string') {
        found.push({ name: item['Name'], value });
      }
    }
    return found;
  }

  /** A request whose body is JSON (an object), a tar archive (bytes or a stream), or nothing. */
  private stream(
    method: string,
    path: string,
    body?: Buffer | Readable | object,
    signal?: AbortSignal,
  ) {
    return new Promise<IncomingMessage>((resolve, reject) => {
      const archive = Buffer.isBuffer(body) || body instanceof Readable;
      const payload =
        body === undefined || body instanceof Readable
          ? null
          : Buffer.isBuffer(body)
            ? body
            : Buffer.from(JSON.stringify(body));
      const outgoing = httpRequest(
        {
          socketPath: this.options.socketPath,
          path: `${API}${path}`,
          method,
          headers: {
            ...(body === undefined
              ? {}
              : { 'content-type': archive ? 'application/x-tar' : 'application/json' }),
            ...(payload === null ? {} : { 'content-length': payload.byteLength }),
          },
          ...(signal === undefined ? {} : { signal }),
        },
        resolve,
      );
      outgoing.on('error', reject);
      if (body instanceof Readable) {
        body.on('error', (error) => outgoing.destroy(error));
        body.pipe(outgoing);
      } else outgoing.end(payload ?? undefined);
    });
  }

  private async call(
    method: string,
    path: string,
    body?: Buffer | Readable | object,
    signal?: AbortSignal,
  ): Promise<Answer> {
    const response = await this.stream(method, path, body, signal);
    const chunks: Buffer[] = [];
    for await (const chunk of response as AsyncIterable<Buffer>) chunks.push(chunk);
    return { status: response.statusCode ?? 0, body: Buffer.concat(chunks) };
  }
}
