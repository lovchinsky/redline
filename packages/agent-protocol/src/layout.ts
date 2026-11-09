/**
 * Where a run's files are inside its sandbox. The receiver prepares them before agent-host
 * starts and collects them after it ends; neither side reads anything else of the other.
 */
export const RUN_LAYOUT = {
  /** The project's working copy at the task's base commit: the agent's working directory. */
  workspace: '/workspace',
  /** What the receiver gives the run, read-only: the brief and the bundle. */
  input: '/redline/input',
  /** The run's brief (`briefSchema`). */
  brief: '/redline/input/brief.json',
  /** The bundle's files at their bundle paths. */
  bundle: '/redline/input/bundle',
  /**
   * The work of the session a run goes on with (`RUN_OUTPUTS.work` of the run that paused): the
   * workspace takes its tree before the agent goes on. Present only when the brief resumes one.
   */
  work: '/redline/input/work.bundle',
  /** The agent's session (`CLAUDE_CONFIG_DIR`): its transcript, kept for a resume. */
  session: '/redline/session',
  /** What agent-host leaves behind: `outcome`, `change`, `work`, `events`. */
  out: '/redline/out',
} as const;

/** Files agent-host writes under `RUN_LAYOUT.out`. */
export const RUN_OUTPUTS = {
  /** The run's outcome (`outcomeSchema`), written last and atomically: its presence ends the run. */
  outcome: 'outcome.json',
  /** The proposed change: a git bundle of one commit on top of the base, at `CHANGE_REF`. */
  change: 'change.bundle',
  /** The work so far of a run that paused: a git bundle of one commit on the base, at `WORK_REF`. */
  work: 'work.bundle',
  /** The run's events (`runEventSchema`), one JSON object per line, as they happen. */
  events: 'events.jsonl',
} as const;

/** The ref `RUN_OUTPUTS.change` carries the change at. */
export const CHANGE_REF = 'refs/redline/change';

/** The ref `RUN_OUTPUTS.work` carries the work of a paused run at. */
export const WORK_REF = 'refs/redline/work';
