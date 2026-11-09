import { RUN_LAYOUT, RUN_OUTPUTS } from '@redline/agent-protocol';
import path from 'node:path';
import { ClaudeSession } from '../adapters/claude/claude-session';
import { VolumeRunFiles } from '../adapters/files/run-files';
import { GatewayClient, type GrantHeader } from '../adapters/gateway/gateway-client';
import { GitWorkspace } from '../adapters/git/git-workspace';
import { systemClock, systemTimers } from '../adapters/system/system';
import { RunAgent } from '../application/run-agent';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The run's grant, from the one variable Claude Code reads for the run's kind of credential: an
 * API key (`x-api-key`) or a subscription token (a bearer token). Both set is a sandbox the
 * receiver did not build; Claude Code would prefer the API key.
 */
const grantOf = (env: Env): GrantHeader => {
  const apiKey = env['ANTHROPIC_API_KEY'];
  const oauth = env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (apiKey !== undefined && oauth !== undefined) {
    throw new Error('Set either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, not both');
  }
  if (apiKey !== undefined && apiKey !== '') return { name: 'x-api-key', value: apiKey };
  if (oauth !== undefined && oauth !== '') {
    return { name: 'authorization', value: `Bearer ${oauth}` };
  }
  throw new Error('No grant: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
};

/** agent-host as the receiver starts it in a sandbox: everything at `RUN_LAYOUT`. */
export const agentHost = (env: Env): RunAgent => {
  const baseUrl = env['ANTHROPIC_BASE_URL'];
  if (baseUrl === undefined || baseUrl === '')
    throw new Error('Set ANTHROPIC_BASE_URL to the gateway');
  const grant = grantOf(env);
  const out = (file: string) => path.posix.join(RUN_LAYOUT.out, file);
  return new RunAgent({
    files: new VolumeRunFiles({
      brief: RUN_LAYOUT.brief,
      events: out(RUN_OUTPUTS.events),
      outcome: out(RUN_OUTPUTS.outcome),
    }),
    session: new ClaudeSession({
      env,
      workspace: RUN_LAYOUT.workspace,
      sessionDir: RUN_LAYOUT.session,
    }),
    workspace: new GitWorkspace({
      root: RUN_LAYOUT.workspace,
      bundlePath: out(RUN_OUTPUTS.change),
    }),
    gateway: new GatewayClient({ baseUrl, grant }),
    clock: systemClock,
    timers: systemTimers,
  });
};
