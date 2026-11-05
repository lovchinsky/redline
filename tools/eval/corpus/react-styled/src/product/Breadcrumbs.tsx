import styled from 'styled-components';

const Trail = styled.nav`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #6b7a72;
`;

export function Breadcrumbs({ trail }: { trail: string[] }) {
  return (
    <Trail aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={crumb}>
          {index > 0 && '/ '}
          {crumb}
        </span>
      ))}
    </Trail>
  );
}
