import { useEffect } from 'preact/hooks';
import { Logo } from '../kit/Logo';
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
    <div class="options">
      <header class="options-header">
        <Logo size={28} />
        <h1>{t.text('optionsTitle')}</h1>
      </header>
      <main class="options-sections">
        <ReceiverForm services={services} />
        <BindingsList services={services} />
        <DiagnosticsSection services={services} />
      </main>
    </div>
  );
};

export const OptionsApp = ({ services }: { services: UiServices }) => (
  <TranslatorProvider translator={services.i18n}>
    <Options services={services} />
  </TranslatorProvider>
);
