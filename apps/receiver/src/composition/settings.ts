/** Where the receiver finds its parts: everything a deployment sets in its environment. */
export interface Settings {
  readonly databaseUrl: string;
  readonly configPath: string;
  readonly blobsPath: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

export const settingsFrom = (env: NodeJS.ProcessEnv): Settings => {
  const port = Number(env.REDLINE_PORT ?? '8787');
  if (!Number.isInteger(port) || port <= 0 || port > 65_535)
    throw new Error('REDLINE_PORT is not a port');
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    configPath: env.REDLINE_CONFIG ?? '/etc/redline/receiver.yaml',
    blobsPath: env.REDLINE_BLOBS ?? '/var/lib/redline/blobs',
    host: env.REDLINE_HOST ?? '0.0.0.0',
    port,
    logLevel: env.REDLINE_LOG_LEVEL ?? 'info',
  };
};
