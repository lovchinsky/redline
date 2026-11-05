import { useState } from 'react';
import styled from 'styled-components';

const Box = styled.section`
  display: grid;
  gap: 16px;
  align-content: start;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 30px;
`;

const Price = styled.p`
  margin: 0;
  font-size: 24px;
  font-weight: 700;
`;

const Swatches = styled.div`
  display: flex;
  gap: 8px;
`;

const Swatch = styled.button<{ $color: string }>`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid #b8c4bd;
  background: ${(props) => props.$color};
`;

const AddToCart = styled.button`
  padding: 14px;
  border: none;
  border-radius: 999px;
  background: #2f6b4f;
  color: white;
  font-size: 16px;
  font-weight: 600;
`;

const Note = styled.p`
  margin: 0;
  color: #6b7a72;
  font-size: 14px;
`;

const colors = [
  { name: 'Moss', value: '#5b7553' },
  { name: 'Slate', value: '#4a5560' },
  { name: 'Ember', value: '#b4553a' },
];

export function BuyBox() {
  const [color, setColor] = useState(colors[0]!.name);
  return (
    <Box>
      <Title>Ridgeline 28L Daypack</Title>
      <Price>$149.00</Price>
      <div>
        <p>Color: {color}</p>
        <Swatches>
          {colors.map((option) => (
            <Swatch
              key={option.name}
              $color={option.value}
              title={option.name}
              onClick={() => setColor(option.name)}
            />
          ))}
        </Swatches>
      </div>
      <AddToCart data-testid="add-to-cart">Add to cart</AddToCart>
      <Note>Free returns within 60 days. Ships in 1–2 business days.</Note>
    </Box>
  );
}
