import { createRoot } from 'react-dom/client';
import './global.css';
import { I18nProvider } from './i18n/I18nProvider';
import { CheckoutPage } from './checkout/CheckoutPage';

createRoot(document.getElementById('root')!).render(
  <I18nProvider locale="en">
    <CheckoutPage />
  </I18nProvider>,
);
