import type { ViewportSnapshot } from '@redline/capture';
import type { Logger } from '@redline/core';
import type { CaptureStartResponse } from '@redline/rpc';
import type { ViewportSnapshots } from '../../ports/capture';
import type { CaptureSession } from './capture-session';

export interface CaptureRuntimeDeps {
  readonly snapshots: ViewportSnapshots;
  readonly createSession: (initialSnapshot: ViewportSnapshot | null) => CaptureSession;
  readonly logger: Logger;
}

/** Keeps at most one capture session per page. */
export class CaptureRuntime {
  private session: CaptureSession | null = null;
  private starting = false;

  constructor(private readonly deps: CaptureRuntimeDeps) {}

  /**
   * Snapshots the page before the overlay exists, so the common case (no scrolling while
   * drawing) never has to hide the overlay for a screenshot.
   */
  async start(): Promise<CaptureStartResponse['status']> {
    if (this.session !== null || this.starting) return 'already-active';
    this.starting = true;
    try {
      const initial = await this.deps.snapshots.take();
      if (!initial.ok) {
        this.deps.logger.warn('Initial snapshot failed; shapes will be captured as drawn', {
          ...initial.error,
        });
      }
      const session = this.deps.createSession(initial.ok ? initial.value : null);
      this.session = session;
      void session.run().then((outcome) => {
        this.deps.logger.debug('Capture session ended', { outcome });
        this.session = null;
      });
      return 'started';
    } finally {
      this.starting = false;
    }
  }

  dispose(): void {
    this.session?.dispose();
  }
}
