import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { DiagnosticsJournal } from './diagnostics-journal';

export const createDiagnosticsHandlers = (
  journal: DiagnosticsJournal,
): Pick<
  ProtocolHandlers<AppProtocol>,
  'diagnostics.record' | 'diagnostics.list' | 'diagnostics.clear'
> => ({
  'diagnostics.record': (report) => journal.record(report),
  'diagnostics.list': () => journal.list(),
  'diagnostics.clear': () => journal.clear(),
});
