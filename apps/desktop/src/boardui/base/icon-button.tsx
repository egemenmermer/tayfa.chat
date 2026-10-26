// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/buttons/icon-button.tsx.
// Tayfa changes: imports only.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType, Ref } from 'react';
import { cx, sortCx } from '@boardui/foundations/cx';
import { directionalIconClass } from '@boardui/foundations/directional-icon';

/**
 * Square icon-only button (secondary look) in two sizes:
 *
 *            container   padding   icon
 *   medium   36x36       8         20
 *   small    32x32       8         16
 */

type IconButtonSize = 'medium' | 'small';

type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconComponent;
  size?: IconButtonSize;
  /** Accessible name, required since there is no visible label. */
  'aria-label': string;
  ref?: Ref<HTMLButtonElement>;
}

export interface IconLinkButtonProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'children'
> {
  icon: IconComponent;
  size?: IconButtonSize;
  /** Accessible name, required since there is no visible label. */
  'aria-label': string;
  ref?: Ref<HTMLAnchorElement>;
}

const styles = sortCx({
  base: [
    'relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-2lg',
    'bg-background-primary-default text-foreground-icon-primary',
    'border border-border-button-default shadow-xs',
    'select-none cursor-pointer',
    'transition-[background-color,border-color,box-shadow,color] duration-150 ease',
    'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring',
    'hover:bg-background-primary-hover hover:border-border-button-hover',
    'active:bg-background-primary-active active:border-border-button-active',
    'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:border-border-button-default disabled:text-icon-button-disabled-foreground disabled:opacity-60 disabled:shadow-none',
  ].join(' '),
  size: {
    medium: 'size-9',
    small: 'size-8',
  },
  icon: {
    medium: 'size-5 shrink-0',
    small: 'size-4 shrink-0',
  },
});

export function IconButton({
  icon: Icon,
  size = 'medium',
  className,
  type = 'button',
  ref,
  ...props
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.base, styles.size[size], className)}
      {...props}
    >
      <Icon className={cx(styles.icon[size], directionalIconClass(Icon))} aria-hidden />
    </button>
  );
}

/** Anchor counterpart to IconButton for external and navigational actions. */
export function IconLinkButton({
  icon: Icon,
  size = 'medium',
  className,
  ref,
  ...props
}: IconLinkButtonProps) {
  return (
    <a ref={ref} className={cx(styles.base, styles.size[size], className)} {...props}>
      <Icon className={cx(styles.icon[size], directionalIconClass(Icon))} aria-hidden />
    </a>
  );
}
