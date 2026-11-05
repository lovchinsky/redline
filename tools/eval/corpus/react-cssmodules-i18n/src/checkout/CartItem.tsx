import { useT } from '../i18n/I18nProvider';
import styles from './CartItem.module.css';

interface CartItemProps {
  sku: string;
  name: string;
  variant: string;
  price: number;
  quantity: number;
}

export function CartItem({ name, variant, price, quantity }: CartItemProps) {
  const t = useT();
  return (
    <div className={styles.item}>
      <div className={styles.thumbnail} aria-hidden="true" />
      <div className={styles.details}>
        <p className={styles.name}>{name}</p>
        <p className={styles.variant}>{variant}</p>
        <p className={styles.quantity}>{t('cart.quantity', { count: quantity })}</p>
      </div>
      <p className={styles.price}>${(price * quantity).toFixed(2)}</p>
      <button className={styles.remove} aria-label={t('cart.remove')}>
        ×
      </button>
    </div>
  );
}
