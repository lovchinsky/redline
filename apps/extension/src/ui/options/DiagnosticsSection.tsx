import type { AppError } from '@redline/core';
import type { CaptureRecord } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { MessageKey, Translator } from '../../ports/i18n';
import type { UiServices } from '../services';
import { ChevronRight, Download } from 'lucide-preact';
import { Badge } from '../kit/Badge';
import { Button } from '../kit/Button';
import { downloadBlob } from '../shared/download';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { ServiceWorkerStatus } from './ServiceWorkerStatus';
import { SettingsSection } from './SettingsSection';

type Outcome = CaptureRecord['collectors'][number]['outcome'];

const OUTCOMES: Readonly<Record<Outcome, MessageKey>> = {
  collected: 'outcomeCollected',
  'not-applicable': 'outcomeNotApplicable',
  failed: 'outcomeFailed',
  'timed-out': 'outcomeTimedOut',
  'invalid-output': 'outcomeInvalidOutput',
};

const milliseconds = (t: Translator, value: number): string => t.number(Math.round(value));

const CaptureEntry = ({ record }: { record: CaptureRecord }) => {
  const t = useTranslator();
  const problems = record.collectors.filter(
    (run) => run.outcome !== 'collected' && run.outcome !== 'not-applicable',
  ).length;
  return (
    <details class="capture-record" data-testid="capture-record">
      <summary>
        <ChevronRight size={14} class="disclosure" aria-hidden="true" />
        <span class="record-time">{t.dateTime(record.at)}</span>
        <code class="record-page">{record.page}</code>
        {problems > 0 && <Badge tone="danger">{t.text('outcomeFailed')}</Badge>}
        <span class="record-duration">
          {t.text('milliseconds', milliseconds(t, record.durationMs))}
        </span>
      </summary>
      <table class="runs">
        <thead>
          <tr>
            <th scope="col">{t.text('diagnosticsCollector')}</th>
            <th scope="col">{t.text('diagnosticsTarget')}</th>
            <th scope="col">{t.text('diagnosticsOutcome')}</th>
            <th scope="col" class="number">
              {t.text('diagnosticsDuration')}
            </th>
          </tr>
        </thead>
        <tbody>
          {record.collectors.map((run) => (
            <tr key={`${run.collector}:${String(run.area)}`} data-outcome={run.outcome}>
              <td>
                <code>{run.collector}</code>
              </td>
              <td>
                {run.area === null
                  ? t.text('diagnosticsStep')
                  : t.text('diagnosticsShape', t.number(run.area))}
              </td>
              <td>{t.text(OUTCOMES[run.outcome])}</td>
              <td class="number">{milliseconds(t, run.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
};

/**
 * The local journal of recent captures: which collectors ran, how long they took and how they
 * ended. Exported as JSON for bug reports; nothing is sent anywhere by itself.
 */
export const DiagnosticsSection = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [records, setRecords] = useState<readonly CaptureRecord[]>([]);
  const [error, setError] = useState<AppError | null>(null);

  const load = useCallback(async () => {
    const listed = await services.rpc.call('diagnostics.list', {});
    if (listed.ok) setRecords(listed.value.records);
    setError(listed.ok ? null : listed.error);
  }, [services]);

  useEffect(() => {
    void load();
    return services.events.on('diagnostics.changed', () => void load());
  }, [services, load]);

  const exportJson = () => {
    const report = { version: 1, exportedAt: services.clock.now(), records };
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
      `redline-diagnostics-${String(services.clock.now())}.json`,
    );
  };

  const clear = async () => {
    const cleared = await services.rpc.call('diagnostics.clear', {});
    setError(cleared.ok ? null : cleared.error);
  };

  return (
    <SettingsSection
      id="diagnostics"
      title={t.text('diagnosticsTitle')}
      description={t.text('diagnosticsHint')}
      actions={
        records.length > 0 && (
          <>
            <Button
              size="sm"
              data-testid="export-diagnostics"
              icon={<Download size={14} aria-hidden="true" />}
              onClick={exportJson}
            >
              {t.text('diagnosticsExport')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => void clear()}>
              {t.text('diagnosticsClear')}
            </Button>
          </>
        )
      }
    >
      {records.length === 0 ? (
        <p class="list-empty" data-testid="no-records">
          {t.text('diagnosticsEmpty')}
        </p>
      ) : (
        <div class="list">
          {records.map((record) => (
            <CaptureEntry key={record.id} record={record} />
          ))}
        </div>
      )}
      <ErrorAlert error={error} />
      <ServiceWorkerStatus services={services} />
    </SettingsSection>
  );
};
