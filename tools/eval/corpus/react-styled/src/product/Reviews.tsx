import styled from 'styled-components';

const Section = styled.section`
  display: grid;
  gap: 16px;
`;

const Review = styled.article`
  padding: 16px;
  border-radius: 12px;
  background: #f3f6f4;
`;

const Stars = styled.span`
  color: #d49b2a;
`;

const reviews = [
  { author: 'Hannah K.', rating: 5, text: 'Carried it up Mount Rainier — comfortable all day.' },
  { author: 'Luis M.', rating: 4, text: 'Great pockets, the hip belt could be wider.' },
];

export function Reviews() {
  return (
    <Section>
      <h2>Customer reviews</h2>
      {reviews.map((review) => (
        <Review key={review.author}>
          <Stars aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}</Stars>
          <p>{review.text}</p>
          <footer>— {review.author}</footer>
        </Review>
      ))}
      <button type="button">Write a review</button>
    </Section>
  );
}
