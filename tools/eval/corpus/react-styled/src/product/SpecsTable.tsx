import styled from 'styled-components';

const Table = styled.table`
  width: 100%;
  margin: 40px 0;
  border-collapse: collapse;

  th,
  td {
    padding: 10px 0;
    border-bottom: 1px solid #e3e9e5;
    text-align: left;
  }
`;

const specs: [string, string][] = [
  ['Capacity', '28 liters'],
  ['Weight', '1.1 kg'],
  ['Laptop sleeve', 'Fits 16-inch laptops'],
  ['Material', 'Recycled 420D nylon'],
];

export function SpecsTable() {
  return (
    <Table>
      <caption>Technical specifications</caption>
      <tbody>
        {specs.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
