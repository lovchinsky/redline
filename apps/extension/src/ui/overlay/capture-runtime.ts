import type { Logger } from '@redline/core';
import type { CaptureStartResponse } from '@redline/rpc';
import type { CaptureSession } from './capture-session';

/** Keeps at most one capture session per page. */
export class CaptureRuntime {
  private session: CaptureSession | null = null;

  constructor(
    private readonly createSession: () => CaptureSession,
    private readonly logger: Logger,
  ) {}

  start(): CaptureStartResponse['status'] {
    if (this.session !== null) return 'already-active';
    const session = this.createSession();
    this.session = session;
    void session.run().then((outcome) => {
      this.logger.debug('Capture session ended', { outcome });
      this.session = null;
    });
    return 'started';
  }

  dispose(): void {
    this.session?.dispose();
  }
}
