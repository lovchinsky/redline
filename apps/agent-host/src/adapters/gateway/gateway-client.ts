import { GRANT_STATUS_PATH, grantStatusSchema, type GrantStatus } from '@redline/agent-protocol';
import type { Gateway } from '../../ports/run';

/** The run's grant, in the header Claude Code sends it in for its kind of credential. */
export type GrantHeader = { readonly name: 'x-api-key' | 'authorization'; readonly value: string };

/** The gateway at `ANTHROPIC_BASE_URL`, asked with the run's own grant. */
export class GatewayClient implements Gateway {
  constructor(
    private readonly options: {
      readonly baseUrl: string;
      readonly grant: GrantHeader;
      readonly fetch?: typeof fetch;
      readonly timeoutMs?: number;
    },
  ) {}

  async grantStatus(): Promise<GrantStatus | null> {
    const call = this.options.fetch ?? fetch;
    try {
      const response = await call(
        `${this.options.baseUrl.replace(/\/$/, '')}${GRANT_STATUS_PATH}`,
        {
          headers: { [this.options.grant.name]: this.options.grant.value },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
        },
      );
      if (!response.ok) return null;
      const parsed = grantStatusSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
