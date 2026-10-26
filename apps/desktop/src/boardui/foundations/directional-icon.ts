// Adapted from the BoardUI free tier (MIT, see ../LICENSE): utils/directional-icon.ts.
import {
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiSidebarFoldLine,
  RiSidebarUnfoldLine,
} from '@remixicon/react';

/** Navigation glyphs mirror in right-to-left layouts; logos, media controls and trends do not. */
const directionalIcons: ReadonlySet<unknown> = new Set([
  RiArrowLeftLine,
  RiArrowLeftSLine,
  RiArrowRightLine,
  RiArrowRightSLine,
  RiSidebarFoldLine,
  RiSidebarUnfoldLine,
]);

export function directionalIconClass(icon: unknown): string | undefined {
  return directionalIcons.has(icon) ? 'rtl:rotate-180' : undefined;
}
