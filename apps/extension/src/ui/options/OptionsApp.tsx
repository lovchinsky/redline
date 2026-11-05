import { useEffect } from 'preact/hooks';
import type { UiServices } from '../services';
import { TranslatorProvider, useTranslator } from '../shared/i18n';
import { BindingsList } from './BindingsList';
import { DiagnosticsSection } from './DiagnosticsSection';
import { ReceiverForm } from './ReceiverForm';

const Options = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  useEffect(() => {
    document.title = t.text('optionsTitle');
  }, [t]);
  return (
    <main class="options">
      <h1>{t.text('optionsTitle')}</h1>
      <ReceiverForm services={services} />
      <BindingsList services={services} />
      <DiagnosticsSection services={services} />
    </main>
  );
};

export const OptionsApp = ({ services }: { services: UiServices }) => (
  <TranslatorProvider translator={services.i18n}>
    <Options services={services} />
  </TranslatorProvider>
);
