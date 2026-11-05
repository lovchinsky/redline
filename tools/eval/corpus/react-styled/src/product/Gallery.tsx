import { useState } from 'react';
import styled from 'styled-components';

const Frame = styled.div`
  display: grid;
  gap: 12px;
`;

const Main = styled.div`
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  background: linear-gradient(135deg, #cfe0d4, #9db8a5);
`;

const Thumbs = styled.div`
  display: flex;
  gap: 8px;
`;

const Thumb = styled.button<{ $active: boolean }>`
  width: 64px;
  height: 64px;
  border-radius: 8px;
  border: 2px solid ${(props) => (props.$active ? '#2f6b4f' : 'transparent')};
  background: #dce7df;
`;

export function Gallery() {
  const [active, setActive] = useState(0);
  return (
    <Frame>
      <Main role="img" aria-label="Ridgeline 28L daypack, front view" />
      <Thumbs>
        {['Front', 'Side', 'Back'].map((view, index) => (
          <Thumb
            key={view}
            $active={index === active}
            aria-label={`Show ${view.toLowerCase()} view`}
            onClick={() => setActive(index)}
          />
        ))}
      </Thumbs>
    </Frame>
  );
}
