import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { FsBlobStore } from '../adapters/blobs/fs-blob-store';
import type { ReceiverConfig } from '../adapters/config/config';
import { DockerSandboxes } from '../adapters/runner-claude/docker-sandboxes';
import type { Logger } from '../ports/system';
import { gitOf } from './receiver';
import type { Settings } from './settings';

const run = promisify(execFile);

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const attempt = async (name: string, work: () => Promise<string>): Promise<Check> => {
  try {
    return { name, ok: true, detail: await work() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
};

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { detail: string } },
): T => {
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
};

/**
 * What a deployment needs beyond a valid configuration, checked against the world it runs in:
 * every project's repository and publishing target, the secret scanner, the sandboxes'
 * isolation, networks and image, and the operator's model credential.
 */
export const checkDeployment = async (
  settings: Settings,
  config: ReceiverConfig,
  logger: Logger,
): Promise<readonly Check[]> => {
  const checks: Check[] = [];
  const operator = config.gateway.operator;
  if (operator !== null) {
    checks.push(
      await attempt('operator’s model credential', async () => {
        const secret = (await readFile(operator.secretFile, 'utf8')).trim();
        if (secret === '') throw new Error(`${operator.secretFile} is empty`);
        return `${operator.kind} in ${operator.secretFile}`;
      }),
    );
  }

  const git = await gitOf(settings, config, new FsBlobStore(settings.blobsPath), logger);
  for (const project of config.projects) {
    const { mirrors, github } = git;
    if (mirrors === null) continue;
    checks.push(
      await attempt(`${project.id}: repository`, async () => {
        const head = unwrap(await mirrors.reach(project.repository));
        return `${project.repository.name}@${project.repository.baseBranch} is at ${head.slice(0, 12)}`;
      }),
    );
    if (github !== null) {
      checks.push(
        await attempt(`${project.id}: publishing`, async () => {
          const target = unwrap(await github.checkTarget(project.repository, project.publishing));
          return `branches go to ${target} (${project.publishing.target})`;
        }),
      );
    }
  }
  if (config.git.kind === 'github') {
    const command = config.git.gitleaks;
    checks.push(
      await attempt('secret scanner', async () => {
        const { stdout } = await run(command, ['version']);
        return `gitleaks ${stdout.trim()}`;
      }),
    );
  }

  const agent = config.agent;
  if (agent.kind === 'claude') {
    const sandboxes = new DockerSandboxes({
      socketPath: agent.dockerSocket,
      runtime: agent.runtime,
      user: `${String(agent.user.uid)}:${String(agent.user.gid)}`,
    });
    checks.push(
      await attempt('sandboxes', async () => {
        const unfit = await sandboxes.unfit([agent.networks.setup, agent.networks.agent]);
        if (unfit !== null) throw new Error(unfit);
        return agent.runtime === 'runsc' ? 'isolated by gVisor' : 'isolation waived: runc';
      }),
    );
    for (const image of new Set(config.projects.map((project) => project.execution.image))) {
      checks.push(
        await attempt(`sandbox image ${image}`, async () => {
          if ((await sandboxes.imageId(image)) === null)
            throw new Error('Docker does not have it: build or pull it');
          return 'present';
        }),
      );
    }
  }
  return checks;
};
