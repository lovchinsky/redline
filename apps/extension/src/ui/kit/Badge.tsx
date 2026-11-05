import type { ComponentChildren } from 'preact';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** A short status with a coloured dot. */
export const Badge = ({
  tone,
  children,
  ...rest
}: {
  tone: Tone;
  children: ComponentChildren;
  'data-testid'?: string;
}) => (
  <span class={`badge badge-${tone}`} {...rest}>
    {children}
  </span>
);
