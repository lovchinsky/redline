import type { Readable } from 'node:stream';

/** A volume mounted into a sandbox. */
export interface Mount {
  readonly volume: string;
  readonly target: string;
  readonly readOnly: boolean;
}

/**
 * One sandbox container, as the runner builds it from configuration: never from task input.
 * Every sandbox runs unprivileged, without capabilities, on a read-only root filesystem, with
 * no resolver, in the network of its phase.
 */
export interface ContainerSpec {
  readonly name: string;
  readonly image: string;
  /** The command, in place of the image's entrypoint; null runs the image's own. */
  readonly command: readonly string[] | null;
  readonly env: Readonly<Record<string, string>>;
  readonly workdir: string;
  readonly mounts: readonly Mount[];
  /** The network the container is on; `none` for no network at all. */
  readonly network: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly limits: { readonly cpus: number; readonly memoryBytes: number; readonly pids: number };
}

export type ContainerState =
  | { readonly status: 'missing' }
  | { readonly status: 'created'; readonly labels: Readonly<Record<string, string>> }
  | {
      readonly status: 'running';
      readonly labels: Readonly<Record<string, string>>;
      /** When it started, in milliseconds since the epoch. */
      readonly startedAt: number;
    }
  | {
      readonly status: 'exited';
      readonly labels: Readonly<Record<string, string>>;
      readonly exitCode: number;
    };

/**
 * Where sandboxes run. It knows containers and volumes, not runs: the runner decides what
 * runs where. Fail closed: a provider that cannot isolate a sandbox as configured refuses to
 * create it.
 */
export interface SandboxProvider {
  /** Why sandboxes cannot run as configured, or null when they can. */
  unfit(networks: readonly string[]): Promise<string | null>;
  /** The id of the image `reference` names where sandboxes run, or null when it is not there. */
  imageId(reference: string): Promise<string | null>;
  createVolume(name: string, labels: Readonly<Record<string, string>>): Promise<void>;
  removeVolume(name: string): Promise<void>;
  /** Creates the container; does nothing when one of that name exists. */
  create(spec: ContainerSpec): Promise<void>;
  /** Unpacks a tar archive at `path` in the container (its volumes included). */
  upload(container: string, path: string, archive: Buffer | Readable): Promise<void>;
  /** A tar archive of `path` in the container, or null when there is nothing there. */
  download(container: string, path: string): Promise<Readable | null>;
  start(container: string): Promise<void>;
  state(container: string): Promise<ContainerState>;
  /** Waits until the container exits; returns its exit code, or null when `signal` aborted. */
  wait(container: string, signal: AbortSignal): Promise<number | null>;
  /** The end of the container's output. */
  logs(container: string, lines: number): Promise<string>;
  /** Kills and removes the container; does nothing when it is gone. */
  remove(container: string): Promise<void>;
  /** Containers and volumes carrying `label`, with that label's value. */
  labelled(label: string): Promise<readonly { readonly name: string; readonly value: string }[]>;
}
