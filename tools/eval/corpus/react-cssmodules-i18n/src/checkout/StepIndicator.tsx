import { useT } from '../i18n/I18nProvider';
import styles from './StepIndicator.module.css';

const steps = ['checkout.steps.cart', 'checkout.steps.shipping', 'checkout.steps.payment'];

export function StepIndicator({ current }: { current: number }) {
  const t = useT();
  return (
    <ol className={styles.steps}>
      {steps.map((key, index) => (
        <li key={key} className={index === current ? styles.current : styles.step}>
          {t(key)}
        </li>
      ))}
    </ol>
  );
}
