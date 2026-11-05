import { useT } from '../i18n/I18nProvider';
import styles from './PromoCodeForm.module.css';

export function PromoCodeForm() {
  const t = useT();
  return (
    <form className={styles.promo} onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="promo-code">{t('promo.label')}</label>
      <div className={styles.row}>
        <input id="promo-code" name="promoCode" autoComplete="off" />
        <button type="submit">{t('promo.apply')}</button>
      </div>
    </form>
  );
}
