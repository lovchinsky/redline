// A stand-in for agent-host inside a test sandbox: it speaks the agent protocol and reports
// what it sees of its sandbox, so a test can tell what the runner gave it and what it did not.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';

const brief = JSON.parse(readFileSync('/redline/input/brief.json', 'utf8'));
const event = (fields) =>
  appendFileSync(
    '/redline/out/events.jsonl',
    `${JSON.stringify({ at: new Date().toISOString(), ...fields })}\n`,
  );
event({ kind: 'started', model: brief.model });

const attempt = (work) => {
  try {
    work();
    return 'allowed';
  } catch (error) {
    return error.code ?? 'refused';
  }
};
const reach = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 2000 });
    socket.once('connect', () => resolve('reached') || socket.destroy());
    socket.once('timeout', () => resolve('timeout') || socket.destroy());
    socket.once('error', (error) => resolve(error.code ?? 'error'));
  });

const seen = {
  title: brief.task.title,
  checks: brief.checks,
  uid: process.getuid(),
  card: readFileSync('/workspace/Card.css', 'utf8'),
  setup:
    attempt(() => readFileSync('/workspace/setup.log', 'utf8')) === 'allowed'
      ? readFileSync('/workspace/setup.log', 'utf8').trim()
      : null,
  bundle: readFileSync(`/redline/input/bundle/${brief.material.entry}`, 'utf8'),
  writeRoot: attempt(() => writeFileSync('/etc/redline', 'x')),
  writeInput: attempt(() => writeFileSync('/redline/input/brief.json', 'x')),
  secrets: attempt(() => readFileSync('/redline/secrets/registry')),
  grant: process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null,
  baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
  internet: await reach('1.1.1.1', 443),
};

const conclude = (result, pause = null) => {
  const outcome = {
    protocol: 1,
    runId: brief.runId,
    result,
    pause,
    usage: { turns: 1, durationMs: 1, costUsd: 0 },
  };
  writeFileSync('/redline/out/.outcome.json.partial', JSON.stringify(outcome));
  renameSync('/redline/out/.outcome.json.partial', '/redline/out/outcome.json');
  event({ kind: 'ended', result: result.kind });
};

// A task "with a question": the first run asks and leaves its session and work; the run that
// goes on with them says what it found of them.
const transcript = (sessionId) => `/redline/session/projects/-workspace/${sessionId}.jsonl`;
if (brief.task.title.includes('question') && brief.resume === null) {
  mkdirSync('/redline/session/projects/-workspace', { recursive: true });
  writeFileSync(transcript('session-1'), '{"asked":"Desktop only?"}\n');
  writeFileSync('/redline/out/work.bundle', 'stand-in work');
  conclude(
    { kind: 'question', question: { text: 'Desktop only?', options: ['Yes', 'No'] } },
    { sessionId: 'session-1', deferredCall: 'toolu_1', workHead: 'd'.repeat(40) },
  );
} else {
  if (brief.resume !== null) {
    const file = transcript(brief.resume.sessionId);
    seen.resumed = {
      pause: brief.resume,
      transcript: readFileSync(file, 'utf8'),
      work: readFileSync('/redline/input/work.bundle', 'utf8'),
      answer: brief.exchanges.at(-1)?.answer?.text ?? null,
      // Claude Code goes on writing to the session.
      appendSession: attempt(() => appendFileSync(file, '{"answered":true}\n')),
    };
  }
  const change = brief.task.title.includes('change');
  if (change) writeFileSync('/redline/out/change.bundle', 'stand-in bundle');
  conclude(
    change
      ? {
          kind: 'change',
          head: 'c'.repeat(40),
          report: {
            outcome: 'change',
            summary: JSON.stringify(seen),
            changes: [],
            verification: '',
            assumptions: [],
            explanation: '',
          },
        }
      : { kind: 'no-change', explanation: JSON.stringify(seen) },
  );
}
