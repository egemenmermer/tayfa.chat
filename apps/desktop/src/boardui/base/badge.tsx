// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/badges/badge.tsx.
// Tayfa changes: imports; the primary pill is the accent fill with Tayfa's on-accent text.
import type { HTMLAttributes, Ref } from 'react';
import { cx, sortCx } from '@boardui/foundations/cx';

/**
 * Small numeric counter pill (nav counts, unread totals): 12/16 semibold, px 4, py 1, radius 4.
 * `primary` sits on a selected row; `neutral` everywhere else.
 */

type BadgeColor = 'primary' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  ref?: Ref<HTMLSpanElement>;
}

const styles = sortCx({
  base: 'inline-flex items-center justify-center rounded-sm px-1 py-px text-caption-1-semibold tracking-normal whitespace-nowrap',
  color: {
    primary: 'bg-accent-500 text-text-on-accent',
    neutral: 'bg-badge-neutral-background text-text-secondary',
  },
});

export function Badge({ color = 'neutral', className, ref, ...props }: BadgeProps) {
  return <span ref={ref} className={cx(styles.base, styles.color[color], className)} {...props} />;
}
