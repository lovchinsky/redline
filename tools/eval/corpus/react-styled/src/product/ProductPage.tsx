import styled from 'styled-components';
import { Breadcrumbs } from './Breadcrumbs';
import { Gallery } from './Gallery';
import { BuyBox } from './BuyBox';
import { Reviews } from './Reviews';
import { SpecsTable } from './SpecsTable';

const Layout = styled.main`
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
`;

const Top = styled.div`
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 40px;
`;

export function ProductPage() {
  return (
    <Layout>
      <Breadcrumbs trail={['Gear', 'Backpacks', 'Daypacks']} />
      <Top>
        <Gallery />
        <BuyBox />
      </Top>
      <SpecsTable />
      <Reviews />
    </Layout>
  );
}
