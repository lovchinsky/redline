import { useT } from '../i18n/I18nProvider';
import styles from './OrderSummary.module.css';

export function OrderSummary({ subtotal, shipping }: { subtotal: number; shipping: number }) {
  const t = useT();
  return (
    <section className={styles.summary}>
      <h2>{t('summary.heading')}</h2>
      <dl className={styles.lines}>
        <dt>{t('summary.subtotal')}</dt>
        <dd>${subtotal.toFixed(2)}</dd>
        <dt>{t('summary.shipping')}</dt>
        <dd>${shipping.toFixed(2)}</dd>
        <dt className={styles.total}>{t('summary.total')}</dt>
        <dd className={styles.total}>${(subtotal + shipping).toFixed(2)}</dd>
      </dl>
      <button className={styles.placeOrder} id="place-order">
        {t('summary.placeOrder')}
      </button>
      <p className={styles.secure}>{t('summary.secure')}</p>
    </section>
  );
}
