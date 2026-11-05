import type { ImagePort } from '@redline/capture';
import { sensitiveRects, type DomQuery } from '@redline/dom';
import type { Logger } from '@redline/core';
import type { AppProtocol, CaptureReportInput, RpcClient } from '@redline/rpc';
import type { StepCommitter, ViewportSnapshots } from '../../ports/capture';
import type { CaptureJournal } from '../../ports/diagnostics';

/** Content-script side of the capture ports: each call is an RPC to the service worker. */
export class RpcImagePort implements ImagePort {
  constructor(private readonly rpc: RpcClient<AppProtocol>) {}

  derive(request: Parameters<ImagePort['derive']>[0]) {
    return this.rpc.call('capture.deriveImage', request);
  }
}

export class RpcStepCommitter implements StepCommitter {
  constructor(private readonly rpc: RpcClient<AppProtocol>) {}

  commit(...[step, capture]: Parameters<StepCommitter['commit']>) {
    return this.rpc.call('capture.commitStep', { step, capture });
  }
}

/**
 * Snapshots the viewport via the service worker and records, at the same instant, the page
 * metrics and sensitive areas needed to interpret and mask it later.
 */
export class RpcViewportSnapshots implements ViewportSnapshots {
  constructor(
    private readonly rpc: RpcClient<AppProtocol>,
    private readonly view: Window,
    private readonly dom: DomQuery,
  ) {}

  async take(): ReturnType<ViewportSnapshots['take']> {
    const { view } = this;
    const scroll = { x: view.scrollX, y: view.scrollY };
    const viewport = { width: view.innerWidth, height: view.innerHeight };
    const masks = sensitiveRects(view.document, this.dom);
    const image = await this.rpc.call('capture.snapshot', {});
    if (!image.ok) return image;
    return {
      ok: true,
      value: {
        asset: image.value.asset,
        scroll,
        viewport,
        devicePixelRatio: view.devicePixelRatio,
        sensitiveRects: masks,
      },
    };
  }
}

/** Sends capture reports to the service worker's journal; a lost report is only logged. */
export class RpcCaptureJournal implements CaptureJournal {
  constructor(
    private readonly rpc: RpcClient<AppProtocol>,
    private readonly logger: Logger,
  ) {}

  async record(report: CaptureReportInput): Promise<void> {
    const recorded = await this.rpc.call('diagnostics.record', report);
    if (!recorded.ok) this.logger.warn('Capture report not recorded', { ...recorded.error });
  }
}
