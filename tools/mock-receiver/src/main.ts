import { startMockReceiver } from './receiver';

/** `pnpm --filter @redline/mock-receiver start [port]` — a receiver to try the extension with. */
const port = Number(process.argv[2] ?? process.env['PORT'] ?? 8787);
const receiver = await startMockReceiver({ port });
console.log(`Mock receiver on ${receiver.url} (project "acme-web")`);
process.on('SIGINT', () => {
  void receiver.close().then(() => process.exit(0));
});
