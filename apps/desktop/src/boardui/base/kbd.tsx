// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/kbd/kbd.tsx.
// Tayfa changes: imports only.
import type { HTMLAttributes, Ref } from 'react';
import { cx } from '@boardui/foundations/cx';

/** Keyboard shortcut hint: 12/16 semibold on a fully rounded neutral pill, px 4, py 2. */
export interface KbdProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>;
}

export function Kbd({ className, ref, ...props }: KbdProps) {
  return (
    <kbd
      ref={ref}
      className={cx(
        'inline-flex items-center justify-center rounded-full bg-kbd-background px-1 py-0.5 font-sans text-caption-1-semibold tracking-normal whitespace-nowrap text-kbd-foreground',
        className,
      )}
      {...props}
    />
  );
}
