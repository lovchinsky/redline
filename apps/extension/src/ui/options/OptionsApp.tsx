import type { UiServices } from '../services';
import { BindingsList } from './BindingsList';
import { OPTIONS_TEXT } from './copy';
import { ReceiverForm } from './ReceiverForm';

export const OptionsApp = ({ services }: { services: UiServices }) => (
  <main class="options">
    <header>
      <h1>{OPTIONS_TEXT.title}</h1>
    </header>
    <ReceiverForm services={services} />
    <BindingsList services={services} />
  </main>
);
