// A stand-in for agent-host inside a test sandbox: it speaks the agent protocol and reports
// what it sees of its sandbox, so a test can tell what the runner gave it and what it did not.
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

const change = brief.task.title.includes('change');
if (change) writeFileSync('/redline/out/change.bundle', 'stand-in bundle');
const outcome = {
  protocol: 1,
  runId: brief.runId,
  result: change
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
  usage: { turns: 1, durationMs: 1, costUsd: 0 },
};
writeFileSync('/redline/out/.outcome.json.partial', JSON.stringify(outcome));
renameSync('/redline/out/.outcome.json.partial', '/redline/out/outcome.json');
event({ kind: 'ended', result: outcome.result.kind });
