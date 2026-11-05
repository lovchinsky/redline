import { useT } from '../i18n/I18nProvider';
import styles from './PaymentMethods.module.css';

export function PaymentMethods() {
  const t = useT();
  return (
    <section className={styles.payment} data-testid="payment-methods">
      <h2>{t('payment.heading')}</h2>
      <div className={styles.methods}>
        <button className={styles.method}>{t('payment.card')}</button>
        <button className={styles.method}>{t('payment.paypal')}</button>
      </div>
    </section>
  );
}
