import type { Brief, GrantStatus, Outcome, RunEvent } from '@redline/agent-protocol';
import type { WorkspaceChange } from '../../domain/outcome';
import type { SessionResult } from '../../domain/session';
import type { AgentSession, SessionRequest } from '../../ports/agent';
import type { Gateway, RunFiles, Workspace } from '../../ports/run';
import type { Clock, Timers } from '../../ports/system';
import { sampleBrief } from './brief';

export class MemoryRunFiles implements RunFiles {
  readonly events: RunEvent[] = [];
  outcome: Outcome | null = null;

  constructor(private readonly given: Brief = sampleBrief()) {}

  brief(): Promise<Brief> {
    return Promise.resolve(this.given);
  }

  journal(event: RunEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  conclude(outcome: Outcome): Promise<void> {
    this.outcome = outcome;
    return Promise.resolve();
  }
}

/** Timers the test fires by hand. */
export class ManualTimers implements Timers {
  private next = 0;
  readonly pending = new Map<number, { ms: number; callback: () => void }>();

  after(ms: number, callback: () => void): () => void {
    const id = (this.next += 1);
    this.pending.set(id, { ms, callback });
    return () => this.pending.delete(id);
  }

  /** Fires the pending timer set for `ms`. */
  fire(ms: number): void {
    for (const [id, timer] of this.pending) {
      if (timer.ms === ms) {
        this.pending.delete(id);
        timer.callback();
      }
    }
  }
}

export const fixedClock: Clock = { now: () => 0, iso: () => '2026-11-09T12:00:00.000Z' };

/** A session the test scripts: it runs `script` with the request and the abort signal. */
export class ScriptedSession implements AgentSession {
  request: SessionRequest | null = null;

  constructor(
    private readonly script: (
      request: SessionRequest,
      signal: AbortSignal,
    ) => Promise<SessionResult>,
    /** The sessions whose files are here. */
    private readonly sessions: readonly string[] = [],
  ) {}

  run(request: SessionRequest, signal: AbortSignal): Promise<SessionResult> {
    this.request = request;
    return this.script(request, signal);
  }

  stored(sessionId: string): Promise<boolean> {
    return Promise.resolve(this.sessions.includes(sessionId));
  }
}

export class FixedWorkspace implements Workspace {
  exported = 0;
  readonly restored: { baseSha: string; head: string }[] = [];

  constructor(
    private readonly change: WorkspaceChange,
    /** The work so far; an Error is an export that fails. */
    private readonly work: WorkspaceChange | Error = null,
  ) {}

  exportChange(): Promise<WorkspaceChange> {
    this.exported += 1;
    return Promise.resolve(this.change);
  }

  exportWork(): Promise<WorkspaceChange> {
    return this.work instanceof Error ? Promise.reject(this.work) : Promise.resolve(this.work);
  }

  restoreWork(baseSha: string, head: string): Promise<void> {
    this.restored.push({ baseSha, head });
    return Promise.resolve();
  }
}

export class FixedGateway implements Gateway {
  asked = 0;
  constructor(private readonly status: GrantStatus | null) {}
  grantStatus(): Promise<GrantStatus | null> {
    this.asked += 1;
    return Promise.resolve(this.status);
  }
}
