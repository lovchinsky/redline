/**
 * Where a run's files are inside its sandbox. The receiver prepares them before agent-host
 * starts and collects them after it ends; neither side reads anything else of the other.
 */
export const RUN_LAYOUT = {
  /** The project's working copy at the task's base commit: the agent's working directory. */
  workspace: '/workspace',
  /** The run's brief (`briefSchema`), read-only. */
  brief: '/redline/brief.json',
  /** The bundle's files at their bundle paths, read-only. */
  bundle: '/redline/bundle',
  /** The agent's session (`CLAUDE_CONFIG_DIR`): its transcript, kept for a resume. */
  session: '/redline/session',
  /** What agent-host leaves behind: `outcome`, `change`, `events`. */
  out: '/redline/out',
} as const;

/** Files agent-host writes under `RUN_LAYOUT.out`. */
export const RUN_OUTPUTS = {
  /** The run's outcome (`outcomeSchema`), written last and atomically: its presence ends the run. */
  outcome: 'outcome.json',
  /** The proposed change: a git bundle of one commit on top of the base, at `CHANGE_REF`. */
  change: 'change.bundle',
  /** The run's events (`runEventSchema`), one JSON object per line, as they happen. */
  events: 'events.jsonl',
} as const;

/** The ref `RUN_OUTPUTS.change` carries the change at. */
export const CHANGE_REF = 'refs/redline/change';
