// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/input/hint-text.tsx.
// Tayfa changes: imports only.
import type { ReactNode, Ref } from 'react';
import type { TextProps as AriaTextProps } from 'react-aria-components';
import { Text as AriaText } from 'react-aria-components';
import { cx } from '@boardui/foundations/cx';

/**
 * Caption below a field (Caption 1/Medium, text/secondary or text/error-primary). React Aria Text,
 * so the parent TextField wires `aria-describedby` / `aria-errormessage`.
 */
export interface HintTextProps extends AriaTextProps {
  children: ReactNode;
  isInvalid?: boolean;
  ref?: Ref<HTMLElement>;
}

export function HintText({ isInvalid = false, className, ...props }: HintTextProps) {
  return (
    <AriaText
      slot={isInvalid ? 'errorMessage' : 'description'}
      {...props}
      className={cx(
        'pt-px text-caption-1-medium text-text-secondary',
        isInvalid && 'text-text-error-primary',
        className,
      )}
    />
  );
}
