import type { ComponentTrace, PageRuntimePort, RuntimeReport } from '@redline/capture';
import { appError, err, ok, type AppError, type Logger, type Result } from '@redline/core';
import type { ClientResult, PageRuntimeClient } from '@redline/page-runtime/client';
import type { AppProtocol, RpcClient } from '@redline/rpc';

const failure = <T>(result: ClientResult<T>): Result<T, AppError> => {
  if (result.ok) return ok(result.value);
  const { failure: reason } = result;
  return err(
    appError(
      'bridge-unavailable',
      reason.kind === 'no-runtime' ? 'The page runtime is not running' : reason.reason,
      { kind: reason.kind },
    ),
  );
};

/**
 * Content-script side of the page runtime: talks to it over DOM events and, the first time
 * it is needed in a page, asks the service worker to run it in the MAIN world.
 */
export class BridgePageRuntime implements PageRuntimePort {
  private ready = false;

  constructor(
    private readonly client: PageRuntimeClient,
    private readonly rpc: RpcClient<AppProtocol>,
    private readonly logger: Logger,
  ) {}

  async componentTrace(element: Element): Promise<Result<ComponentTrace | null, AppError>> {
    const ready = await this.ensureReady();
    return ready.ok ? failure(this.client.componentTrace(element)) : ready;
  }

  async runtimeReport(): Promise<Result<RuntimeReport, AppError>> {
    const ready = await this.ensureReady();
    return ready.ok ? failure(this.client.runtimeReport()) : ready;
  }

  /** A failed injection is not remembered: the next step tries again. */
  private async ensureReady(): Promise<Result<void, AppError>> {
    if (this.ready) return ok(undefined);
    if (!this.client.ping().ok) {
      const injected = await this.rpc.call('capture.injectPageRuntime', {});
      if (!injected.ok) {
        this.logger.debug('Page runtime unavailable', { ...injected.error });
        return injected;
      }
    }
    const ping = failure(this.client.ping());
    if (!ping.ok) return ping;
    this.ready = true;
    return ok(undefined);
  }
}
