import { useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import styles from './ShippingOptions.module.css';

const options = [
  { id: 'standard', key: 'shipping.standard', price: 'Free' },
  { id: 'express', key: 'shipping.express', price: '$12.00' },
  { id: 'pickup', key: 'shipping.pickup', price: 'Free' },
];

export function ShippingOptions() {
  const t = useT();
  const [selected, setSelected] = useState('standard');
  return (
    <fieldset className={styles.options}>
      <legend>{t('shipping.heading')}</legend>
      {options.map((option) => (
        <label key={option.id} className={styles.option}>
          <input
            type="radio"
            name="shippingMethod"
            value={option.id}
            checked={selected === option.id}
            onChange={() => setSelected(option.id)}
          />
          <span>{t(option.key)}</span>
          <span className={styles.price}>{option.price}</span>
        </label>
      ))}
    </fieldset>
  );
}
