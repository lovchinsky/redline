/** Where the receiver finds its parts: everything a deployment sets in its environment. */
export interface Settings {
  readonly databaseUrl: string;
  readonly configPath: string;
  readonly blobsPath: string;
  readonly host: string;
  /** The API's port. */
  readonly port: number;
  /** The gateway's model port, for agent sandboxes. */
  readonly gatewayPort: number;
  /** The gateway's egress port, for setup sandboxes. */
  readonly egressPort: number;
  /** The gateway's vault, shared by the receiver's services on a volume. */
  readonly vaultSocket: string;
  readonly logLevel: string;
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const portOf = (env: NodeJS.ProcessEnv, name: string, fallback: number): number => {
  const port = Number(env[name] ?? String(fallback));
  if (!Number.isInteger(port) || port <= 0 || port > 65_535)
    throw new Error(`${name} is not a port`);
  return port;
};

export const settingsFrom = (env: NodeJS.ProcessEnv): Settings => {
  const port = portOf(env, 'REDLINE_PORT', 8787);
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    configPath: env.REDLINE_CONFIG ?? '/etc/redline/receiver.yaml',
    blobsPath: env.REDLINE_BLOBS ?? '/var/lib/redline/blobs',
    host: env.REDLINE_HOST ?? '0.0.0.0',
    port,
    gatewayPort: portOf(env, 'REDLINE_GATEWAY_PORT', 8788),
    egressPort: portOf(env, 'REDLINE_EGRESS_PORT', 3128),
    vaultSocket: env.REDLINE_VAULT_SOCKET ?? '/run/redline/vault.sock',
    logLevel: env.REDLINE_LOG_LEVEL ?? 'info',
  };
};
