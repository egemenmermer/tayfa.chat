// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/switch/switch.tsx.
// Tayfa changes: imports only.
import type { ReactNode, Ref } from 'react';
import { Switch as AriaSwitch } from 'react-aria-components';
import type { SwitchProps as AriaSwitchProps } from 'react-aria-components';
import { cx, sortCx } from '@boardui/foundations/cx';

/**
 * Toggle switch: two shapes (pill, rectangle) x three sizes (sm 28x16, md 42x24, lg 56x32).
 * Off: tertiary track. On: the accent gradient with an inset ring and top highlight. The thumb carries
 * a small embossed chip that takes the accent when on. `SwitchTrack` is shared with switch cards.
 */

export type SwitchSize = 'sm' | 'md' | 'lg';
export type SwitchShape = 'pill' | 'rectangle';

export const switchSizes = sortCx({
  sm: {
    track: 'h-4 w-7',
    trackRadius: { pill: 'rounded-full', rectangle: 'rounded-[3px]' },
    onShadow:
      'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.5px_var(--color-accent-500)]',
    thumb: 'size-3',
    thumbRadius: { pill: 'rounded-full', rectangle: 'rounded-[1px]' },
    offset: 'start-0.5 top-0.5',
    travel: 'translate-x-3 rtl:-translate-x-3',
    chip: 'size-[5px] border-[0.25px] shadow-[0_2px_2px_0_rgb(0_0_0/0.03)]',
    chipRadius: { pill: 'rounded-full', rectangle: 'rounded-[0.5px]' },
  },
  md: {
    track: 'h-6 w-[42px]',
    trackRadius: { pill: 'rounded-full', rectangle: 'rounded-[4.5px]' },
    onShadow:
      'shadow-[inset_0_1.5px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.75px_var(--color-accent-500)]',
    thumb: 'size-[18px]',
    thumbRadius: { pill: 'rounded-full', rectangle: 'rounded-[1.5px]' },
    offset: 'start-[3px] top-[3px]',
    travel: 'translate-x-[18px] rtl:-translate-x-[18px]',
    chip: 'size-[7.5px] border-[0.375px] shadow-[0_3px_3px_0_rgb(0_0_0/0.03)]',
    chipRadius: { pill: 'rounded-full', rectangle: 'rounded-[0.75px]' },
  },
  lg: {
    track: 'h-8 w-14',
    trackRadius: { pill: 'rounded-full', rectangle: 'rounded-md' },
    onShadow: 'shadow-checkbox-selected',
    thumb: 'size-6',
    thumbRadius: { pill: 'rounded-full', rectangle: 'rounded-xs' },
    offset: 'start-1 top-1',
    travel: 'translate-x-6 rtl:-translate-x-6',
    chip: 'size-[10px] border-[0.5px] shadow-[0_4px_4px_0_rgb(0_0_0/0.03)]',
    chipRadius: { pill: 'rounded-full', rectangle: 'rounded-[1px]' },
  },
});

export interface SwitchVisualState {
  isSelected: boolean;
  isDisabled: boolean;
  isFocusVisible: boolean;
}

/** Track, thumb and chip. Pure presentation: the React Aria Switch owns the input. */
export function SwitchTrack({
  state,
  size = 'md',
  shape = 'pill',
}: {
  state: SwitchVisualState;
  size?: SwitchSize;
  shape?: SwitchShape;
}) {
  const s = switchSizes[size];

  return (
    <span
      aria-hidden
      className={cx(
        'relative shrink-0 transition-colors duration-200 ease',
        s.track,
        s.trackRadius[shape],
        state.isSelected
          ? cx('bg-linear-to-b from-accent-500 to-accent-600', s.onShadow)
          : 'bg-background-tertiary-default',
        state.isDisabled && 'opacity-50',
        state.isFocusVisible && 'ring-2 ring-border-focus-ring ring-offset-2',
      )}
    >
      <span
        className={cx(
          'absolute flex items-center justify-center',
          'bg-linear-to-b from-control-indicator-background from-[43.837%] to-control-indicator-background-subtle',
          'shadow-[0_3px_3px_0_rgb(0_0_0/0.03),0_0.75px_0_0_rgb(0_0_0/0.05)]',
          'transition-transform duration-200 ease',
          s.thumb,
          s.thumbRadius[shape],
          s.offset,
          state.isSelected && s.travel,
        )}
      >
        {/* Embossed chip; the gradient runs bottom to top without a transform so it stays pixel-snapped. */}
        <span
          className={cx(
            'border-solid bg-linear-to-t from-[43.837%]',
            s.chip,
            s.chipRadius[shape],
            state.isSelected
              ? 'border-accent-600 from-switch-on-chip-start to-switch-on-chip-end'
              : 'border-border-button-default/50 from-switch-off-chip-start to-switch-off-chip-end',
          )}
        />
      </span>
    </span>
  );
}

export interface SwitchProps extends Omit<AriaSwitchProps, 'children'> {
  children?: ReactNode;
  size?: SwitchSize;
  shape?: SwitchShape;
  ref?: Ref<HTMLLabelElement>;
}

export function Switch({
  className,
  children,
  size = 'md',
  shape = 'pill',
  ref,
  ...props
}: SwitchProps) {
  return (
    <AriaSwitch
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          'group inline-flex items-center gap-2 select-none',
          state.isDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {(state) => (
        <>
          <SwitchTrack state={state} size={size} shape={shape} />
          {children != null && children !== false && (
            <span className="text-body-medium text-text-primary">{children}</span>
          )}
        </>
      )}
    </AriaSwitch>
  );
}
