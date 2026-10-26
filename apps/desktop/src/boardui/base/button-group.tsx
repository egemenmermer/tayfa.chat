// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/buttons/button-group.tsx.
// Tayfa changes: imports only.
import type { ButtonHTMLAttributes, ComponentType, ReactNode, Ref } from 'react';
import { cx, sortCx } from '@boardui/foundations/cx';
import { directionalIconClass } from '@boardui/foundations/directional-icon';

/**
 * A row of secondary-style buttons fused into one control: shared border, radius 10, shadow/xs,
 * hairline dividers, only the outer corners rounded.
 *   medium  h=34 px=12, Body/Medium, 20px icons     small  h=30 px=10, 18px icons
 * Items can be text, icon + text or icon-only (`iconOnly` + `aria-label`). `selected` keeps the hover
 * fill and sets aria-pressed. For a switcher with an animated thumb use SegmentedControl.
 */

type ButtonGroupSize = 'medium' | 'small';

type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

const styles = sortCx({
  group: [
    'inline-flex items-stretch isolate',
    'rounded-2lg border border-border-button-group bg-background-primary-default shadow-xs',
    'divide-x divide-border-button-default overflow-hidden',
  ].join(' '),

  item: [
    'inline-flex items-center justify-center gap-1 whitespace-nowrap',
    'bg-background-primary-default text-text-primary font-sans select-none cursor-pointer',
    'transition-[background-color,color] duration-150 ease',
    'outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring',
    'hover:bg-background-primary-hover active:bg-background-primary-active',
    'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary',
  ].join(' '),

  size: {
    medium: 'h-[34px] px-3 text-body-medium',
    small: 'h-[30px] px-2.5 text-body-medium',
  },

  iconOnlySize: {
    medium: 'w-[34px] px-0',
    small: 'w-[30px] px-0',
  },

  icon: {
    medium: 'size-5 shrink-0',
    small: 'size-[18px] shrink-0',
  },

  selected: 'bg-background-primary-hover',
});

export interface ButtonGroupProps {
  size?: ButtonGroupSize;
  /** ButtonGroupItem children. */
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
  ref?: Ref<HTMLDivElement>;
}

export function ButtonGroup({
  size = 'medium',
  children,
  className,
  ref,
  ...props
}: ButtonGroupProps) {
  return (
    <div ref={ref} role="group" data-size={size} className={cx(styles.group, className)} {...props}>
      {children}
    </div>
  );
}

export interface ButtonGroupItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  size?: ButtonGroupSize;
  /** Highlights the item like its hover state; sets aria-pressed. */
  selected?: boolean;
  iconOnly?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function ButtonGroupItem({
  size = 'medium',
  selected = false,
  iconOnly = false,
  leadingIcon: Leading,
  trailingIcon: Trailing,
  children,
  className,
  type = 'button',
  ref,
  ...props
}: ButtonGroupItemProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected || undefined}
      className={cx(
        styles.item,
        styles.size[size],
        iconOnly && styles.iconOnlySize[size],
        selected && styles.selected,
        className,
      )}
      {...props}
    >
      {Leading ? (
        <Leading className={cx(styles.icon[size], directionalIconClass(Leading))} aria-hidden />
      ) : null}
      {!iconOnly && children !== undefined && children !== null && <span>{children}</span>}
      {!iconOnly && Trailing ? (
        <Trailing className={cx(styles.icon[size], directionalIconClass(Trailing))} aria-hidden />
      ) : null}
    </button>
  );
}
