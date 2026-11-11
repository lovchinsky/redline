import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

/** Class names joined, falsy parts dropped. */
const classes = (...parts: readonly (string | false | undefined)[]): string =>
  parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');

const classNameOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonProps = Omit<ButtonHTMLAttributes, 'icon' | 'size'> & {
  readonly variant?: Variant;
  readonly size?: 'sm' | 'md';
  readonly icon?: ComponentChildren;
  readonly block?: boolean;
  readonly grow?: boolean;
};

/** A text button; the variant says how much it matters on the screen. */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  icon,
  block = false,
  grow = false,
  class: className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    class={classes(
      'btn',
      `btn-${variant}`,
      size === 'sm' && 'btn-sm',
      block && 'btn-block',
      grow && 'btn-grow',
      classNameOf(className),
    )}
    {...rest}
  >
    {icon}
    {children !== undefined && <span class="btn-label">{children}</span>}
  </button>
);

type IconButtonProps = Omit<ButtonHTMLAttributes, 'label'> & {
  /** Read by screen readers and shown as a tooltip. */
  readonly label: string;
  readonly danger?: boolean;
};

/** An icon-only button; its label is its accessible name and tooltip. */
export const IconButton = ({
  label,
  danger = false,
  class: className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) => (
  <button
    type={type}
    class={classes('icon-btn', danger && 'danger', classNameOf(className))}
    aria-label={label}
    title={label}
    {...rest}
  >
    {children}
  </button>
);
