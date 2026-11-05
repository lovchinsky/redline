import { useT } from '../i18n/I18nProvider';
import { CartItem } from './CartItem';
import { OrderSummary } from './OrderSummary';
import { PaymentMethods } from './PaymentMethods';
import { PromoCodeForm } from './PromoCodeForm';
import { ShippingOptions } from './ShippingOptions';
import { StepIndicator } from './StepIndicator';
import styles from './CheckoutPage.module.css';

const items = [
  { sku: 'FL-201', name: 'Linen throw pillow', variant: 'Sage / 50×50', price: 34, quantity: 2 },
  { sku: 'FL-118', name: 'Stoneware mug set', variant: 'Set of 4', price: 48, quantity: 1 },
];

export function CheckoutPage() {
  const t = useT();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('checkout.title')}</h1>
      <StepIndicator current={1} />
      <div className={styles.columns}>
        <div className={styles.main}>
          <section>
            <h2>{t('cart.heading')}</h2>
            {items.map((item) => (
              <CartItem key={item.sku} {...item} />
            ))}
          </section>
          <ShippingOptions />
          <PaymentMethods />
        </div>
        <aside className={styles.sidebar}>
          <OrderSummary subtotal={116} shipping={0} />
          <PromoCodeForm />
        </aside>
      </div>
    </div>
  );
}
