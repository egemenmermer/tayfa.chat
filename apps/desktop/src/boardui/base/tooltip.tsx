// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/tooltip/tooltip.tsx.
// Tayfa changes: imports; direction from React Aria's locale; the caret keeps BoardUI's 1px stroke
// under Tayfa's global `svg { stroke-width }` rule.
import type { ComponentProps, ReactNode } from 'react';
import { useLocale } from 'react-aria';
import {
  OverlayArrow as AriaOverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
} from 'react-aria-components';
import type { TooltipProps as AriaTooltipProps } from 'react-aria-components';
import { cx, sortCx } from '@boardui/foundations/cx';

/**
 * Tooltip on the raised surface (card/dropdown family): 1px border, radius 8, dropdown shadow.
 *   sm  px 10 py 6, Caption 1/Medium      md  px 12 py 8, Body/Medium
 * React Aria TooltipTrigger/Tooltip: hover and focus open, Escape closes, collision flipping and
 * `aria-describedby`. The trigger's single child must be focusable (wrap a plain <Button> in
 * react-aria-components' <Focusable>).
 */

export type TooltipSize = 'sm' | 'md';

const sizes = sortCx({
  sm: 'px-2.5 py-1.5 text-caption-1-medium',
  md: 'px-3 py-2 text-body-medium rounded-2lg',
});

/**
 * One caret per placement (instead of a rotated path) so the layout box always matches the drawn
 * triangle. Each path is open on the edge that touches the tooltip body.
 */
export const TOOLTIP_CARETS = sortCx({
  top: { width: 12, height: 7, path: 'M0 0 L6 6 L12 0', shadow: '0 1.5px 1px' },
  bottom: { width: 12, height: 7, path: 'M0 7 L6 1 L12 7', shadow: '0 -1.5px 1px' },
  left: { width: 7, height: 12, path: 'M0 0 L6 6 L0 12', shadow: '0 1.5px 1px' },
  right: { width: 7, height: 12, path: 'M7 0 L1 6 L7 12', shadow: '0 1.5px 1px' },
});

export interface TooltipProps extends Omit<AriaTooltipProps, 'children'> {
  children?: ReactNode;
  /** Surface size. Default `sm`. */
  size?: TooltipSize;
  /** Show the caret pointing at the trigger. Default `true`. */
  showArrow?: boolean;
}

export function Tooltip({
  children,
  className,
  size = 'sm',
  showArrow = true,
  offset = 10,
  ...props
}: TooltipProps) {
  const { direction } = useLocale();
  return (
    <AriaTooltip
      dir={direction}
      offset={offset}
      {...props}
      className={(state) =>
        cx(
          'pointer-events-none z-50 max-w-[240px] select-none rounded-lg border border-border-button-default bg-background-primary-default text-text-primary shadow-dropdown',
          sizes[size],
          'transition duration-200 ease-out',
          'data-[entering]:scale-90 data-[entering]:opacity-0 data-[entering]:blur-[4px]',
          'data-[exiting]:scale-90 data-[exiting]:opacity-0 data-[exiting]:blur-[4px]',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {showArrow && (
        <AriaOverlayArrow>
          {({ placement }) => {
            const caret =
              TOOLTIP_CARETS[placement as keyof typeof TOOLTIP_CARETS] ?? TOOLTIP_CARETS.top;
            return (
              <svg
                width={caret.width}
                height={caret.height}
                viewBox={`0 0 ${caret.width} ${caret.height}`}
                className="block overflow-visible fill-background-primary-default stroke-border-button-default stroke-1"
                style={{ filter: `drop-shadow(${caret.shadow} rgb(0 0 0 / 0.05))` }}
              >
                <path d={caret.path} />
              </svg>
            );
          }}
        </AriaOverlayArrow>
      )}
      {children}
    </AriaTooltip>
  );
}

export type TooltipTriggerProps = ComponentProps<typeof AriaTooltipTrigger>;

export function TooltipTrigger({ delay = 0, closeDelay = 0, ...props }: TooltipTriggerProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />;
}
