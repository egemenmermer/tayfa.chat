// Adapted from the BoardUI free tier (MIT, see ../LICENSE):
// components/base/segmented-control/segmented-control.tsx.
// Tayfa changes: imports; the layout direction comes from React Aria's locale (no BoardUI direction
// provider in Tayfa).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { useLocale } from 'react-aria';
import {
  ToggleButton as AriaToggleButton,
  ToggleButtonGroup as AriaToggleButtonGroup,
} from 'react-aria-components';
import type {
  ToggleButtonGroupProps as AriaToggleButtonGroupProps,
  ToggleButtonProps as AriaToggleButtonProps,
} from 'react-aria-components';
import { cx } from '@boardui/foundations/cx';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Single-select segmented control.
 *   track    segmented-control background, p 4, radius 10, gap 2
 *   segment  px 10, py 4, radius 6; selected: raised thumb, Body/Medium, text/primary;
 *            unselected: transparent, Body/Regular, text/secondary
 *
 * React Aria ToggleButtonGroup with a selection that cannot be emptied: arrow keys move focus,
 * Space/Enter selects. `plain` drops the track and the thumb.
 */
export type SegmentedControlVariant = 'solid' | 'plain';

export interface SegmentedControlProps extends Omit<
  AriaToggleButtonGroupProps,
  'selectionMode' | 'disallowEmptySelection'
> {
  children?: ReactNode;
  variant?: SegmentedControlVariant;
  ref?: Ref<HTMLDivElement>;
}

type Thumb = { left: number; top: number; width: number; height: number };

export function SegmentedControl({
  className,
  children,
  variant = 'solid',
  ref,
  ...props
}: SegmentedControlProps) {
  const { direction } = useLocale();
  const innerRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const selected = el.querySelector<HTMLElement>('[data-selected]');
      if (selected) {
        setThumb({
          left: selected.offsetLeft,
          top: selected.offsetTop,
          width: selected.offsetWidth,
          height: selected.offsetHeight,
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const observeItems = () => el.querySelectorAll('button').forEach((item) => ro.observe(item));
    observeItems();
    const mo = new MutationObserver(() => {
      observeItems();
      measure();
    });
    mo.observe(el, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: ['data-selected'],
    });
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [direction]);

  const setRefs = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: HTMLDivElement | null }).current = node;
  };

  return (
    <AriaToggleButtonGroup
      ref={setRefs}
      selectionMode="single"
      disallowEmptySelection
      {...props}
      className={(state) =>
        cx(
          'relative inline-flex items-start gap-0.5 rounded-2lg',
          variant === 'solid' && 'bg-segmented-control-background p-1',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {variant === 'solid' && thumb && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-md bg-segmented-control-selected-background shadow-2xs transition-[transform,width,height] duration-200 ease"
          style={{
            transform: `translate(${thumb.left}px, ${thumb.top}px)`,
            width: thumb.width,
            height: thumb.height,
          }}
        />
      )}
      {children}
    </AriaToggleButtonGroup>
  );
}

export interface SegmentedControlItemProps extends Omit<AriaToggleButtonProps, 'children'> {
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function SegmentedControlItem({
  className,
  children,
  ref,
  ...props
}: SegmentedControlItemProps) {
  return (
    <AriaToggleButton
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          'relative z-10 inline-flex cursor-pointer items-center justify-center rounded-md px-2.5 py-1 text-center whitespace-nowrap',
          'transition-colors duration-200 ease',
          'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          state.isSelected
            ? 'text-body-medium text-text-primary'
            : 'text-body-regular text-text-secondary hover:text-text-primary',
          state.isDisabled && 'cursor-not-allowed opacity-50',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {children}
    </AriaToggleButton>
  );
}
