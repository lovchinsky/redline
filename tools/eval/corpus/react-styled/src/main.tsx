import { createRoot } from 'react-dom/client';
import { GlobalStyle } from './GlobalStyle';
import { ProductPage } from './product/ProductPage';

createRoot(document.getElementById('root')!).render(
  <>
    <GlobalStyle />
    <ProductPage />
  </>,
);
