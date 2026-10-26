// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/input/label.tsx.
// Tayfa changes: imports only.
import type { ReactNode, Ref } from 'react';
import { RiInformationFill } from '@remixicon/react';
import type { LabelProps as AriaLabelProps } from 'react-aria-components';
import { Label as AriaLabel } from 'react-aria-components';
import { cx } from '@boardui/foundations/cx';

/**
 * Field label (Body/Medium, text/primary) with an optional required asterisk and info glyph.
 * React Aria Label, so the parent TextField wires `htmlFor` / `aria-labelledby`.
 */
export interface LabelProps extends AriaLabelProps {
  children: ReactNode;
  isRequired?: boolean;
  /** Reserved for invalid-aware styling. */
  isInvalid?: boolean;
  /** Show the info glyph next to the label. */
  tooltip?: boolean | string;
  ref?: Ref<HTMLLabelElement>;
}

export function Label({
  isRequired = false,
  isInvalid: _isInvalid,
  tooltip,
  className,
  children,
  ...props
}: LabelProps) {
  void _isInvalid;
  return (
    <AriaLabel
      data-label="true"
      {...props}
      className={cx(
        'flex cursor-default items-center gap-0.5',
        'text-body-medium text-text-primary',
        className,
      )}
    >
      {children}
      {isRequired && (
        <span aria-hidden="true" className="text-body-medium text-text-error-primary">
          *
        </span>
      )}
      {tooltip && (
        <RiInformationFill
          className="size-4 shrink-0 text-foreground-icon-quaternary"
          aria-hidden
        />
      )}
    </AriaLabel>
  );
}
