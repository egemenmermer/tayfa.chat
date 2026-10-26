import { cloneElement, type JSX, type ReactElement } from 'react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@boardui/base/tooltip';

/**
 * A control that may be unavailable. With a `reason` the child stays focusable but inert (`aria-disabled`, no
 * click handler) and hover/focus shows the reason; a natively disabled button could not open a tooltip.
 */
export function Explained({
  reason,
  children,
  placement = 'bottom',
}: {
  reason: string | null | false | undefined;
  children: JSX.Element;
  placement?: 'top' | 'bottom' | 'start' | 'end';
}) {
  if (!reason) return children;
  return (
    <TooltipTrigger>
      <Focusable>
        {
          cloneElement(children as ReactElement<Record<string, unknown>>, {
            'aria-disabled': true,
            disabled: undefined,
            onClick: undefined,
            onChange: undefined,
          }) as JSX.Element
        }
      </Focusable>
      <Tooltip placement={placement}>{reason}</Tooltip>
    </TooltipTrigger>
  );
}
