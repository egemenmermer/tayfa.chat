// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/buttons/button.tsx.
// Tayfa changes: imports, and text on the primary/danger fills uses Tayfa's on-accent/on-danger tokens.
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ComponentType,
  ReactNode,
  Ref,
} from 'react';
import { cx, sortCx } from '@boardui/foundations/cx';
import { directionalIconClass } from '@boardui/foundations/directional-icon';

/**
 * Primary, secondary, ghost and danger buttons in three sizes.
 *
 *                Medium            Small                Xs
 *   container    h=36 p=8 r=10     h=32 px=8 py=6 r=8   h=24 px=8 r=4
 *   icon         20                18                   14
 *   text         Body/Medium       Body/Medium          Caption 1/Semibold
 *
 * Icons are rendered by the component through `leadingIcon` / `trailingIcon` (pass a Remix Icon
 * component reference, `RiAddLine`, not `<RiAddLine />`). Icon-only:
 *   <Button iconOnly leadingIcon={RiAddLine} aria-label={t('Ekle')} />
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'medium' | 'small' | 'xs';

type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
}

const styles = sortCx({
  base: [
    'inline-flex items-center justify-center gap-0.5 whitespace-nowrap overflow-hidden',
    'font-sans select-none cursor-pointer',
    'button-press-motion',
    'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring',
    'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
  ].join(' '),

  size: {
    medium: 'h-9 rounded-2lg p-2 text-body-medium',
    small: 'h-8 rounded-lg px-2 py-1.5 text-body-medium',
    xs: 'h-6 rounded-sm px-2 text-caption-1-semibold',
  },

  // Icon-only: medium stays 36x36 from its content; small and xs are forced squares.
  iconOnlySize: {
    medium: '',
    small: 'size-8 p-0',
    xs: 'size-6 p-0',
  },

  icon: {
    medium: 'size-5 shrink-0',
    small: 'size-[18px] shrink-0',
    xs: 'size-3.5 shrink-0',
  },

  label: {
    medium: 'inline-flex items-center justify-center px-1 shrink-0',
    small: 'inline-flex items-center justify-center px-0.5 shrink-0',
    xs: 'inline-flex items-center justify-center px-0.5 shrink-0',
  },

  variant: {
    primary: [
      'bg-button-primary text-text-on-accent shadow-xs',
      'disabled:text-button-primary-disabled-foreground disabled:shadow-none',
      'aria-disabled:text-button-primary-disabled-foreground aria-disabled:shadow-none',
    ].join(' '),
    danger: [
      'bg-button-danger text-text-on-danger shadow-xs',
      'disabled:text-foreground-disabled-danger disabled:shadow-none',
      'aria-disabled:text-foreground-disabled-danger aria-disabled:shadow-none',
    ].join(' '),
    secondary: [
      'bg-background-primary-default text-text-primary',
      'border border-border-button-default shadow-xs',
      'hover:bg-background-primary-hover  hover:border-border-button-hover',
      'active:bg-background-primary-active active:border-border-button-active',
      'disabled:bg-background-primary-disabled disabled:border-border-button-default disabled:text-text-tertiary disabled:shadow-none',
      'aria-disabled:bg-background-primary-disabled aria-disabled:border-border-button-default aria-disabled:text-text-tertiary aria-disabled:shadow-none',
    ].join(' '),
    ghost: [
      'bg-button-ghost-background text-button-ghost-foreground',
      'hover:bg-button-ghost-hover active:bg-button-ghost-active',
      'disabled:bg-button-ghost-disabled disabled:text-button-ghost-disabled-foreground disabled:shadow-none',
      'aria-disabled:bg-button-ghost-disabled aria-disabled:text-button-ghost-disabled-foreground aria-disabled:shadow-none',
    ].join(' '),
  },
});

export function Button({
  variant = 'primary',
  size = 'medium',
  iconOnly = false,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  children,
  className,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.base,
        styles.size[size],
        styles.variant[variant],
        iconOnly && styles.iconOnlySize[size],
        className,
      )}
      {...props}
    >
      {Leading ? (
        <Leading className={cx(styles.icon[size], directionalIconClass(Leading))} aria-hidden />
      ) : null}
      {!iconOnly && children !== undefined && children !== null && (
        <span className={styles.label[size]}>{children}</span>
      )}
      {!iconOnly && Trailing ? (
        <Trailing className={cx(styles.icon[size], directionalIconClass(Trailing))} aria-hidden />
      ) : null}
    </button>
  );
}

/** Anchor counterpart to Button for navigational actions. */
export function ButtonLink({
  variant = 'primary',
  size = 'medium',
  iconOnly = false,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  children,
  className,
  ref,
  ...props
}: ButtonLinkProps) {
  return (
    <a
      ref={ref}
      className={cx(
        styles.base,
        styles.size[size],
        styles.variant[variant],
        iconOnly && styles.iconOnlySize[size],
        className,
      )}
      {...props}
    >
      {Leading ? (
        <Leading className={cx(styles.icon[size], directionalIconClass(Leading))} aria-hidden />
      ) : null}
      {!iconOnly && children !== undefined && children !== null && (
        <span className={styles.label[size]}>{children}</span>
      )}
      {!iconOnly && Trailing ? (
        <Trailing className={cx(styles.icon[size], directionalIconClass(Trailing))} aria-hidden />
      ) : null}
    </a>
  );
}

/** Style maps, exported for composition (button groups, menus). */
export const buttonStyles = styles;
