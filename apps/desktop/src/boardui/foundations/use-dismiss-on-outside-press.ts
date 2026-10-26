// Adapted from the BoardUI free tier (MIT, see ../LICENSE): utils/use-dismiss-on-outside-press.ts.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * React Aria's non-modal popovers (used to avoid the modal scroll lock) are not dismissed by an
 * outside press. This restores that: a pointerdown outside every given ref closes the popover.
 */
export function useDismissOnOutsidePress(
  isOpen: boolean,
  onDismiss: () => void,
  refs: RefObject<HTMLElement | null>[],
) {
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onDismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen, onDismiss, refs]);
}

/**
 * Pressing the trigger of an open non-modal popover should close it, but React Aria reports close
 * and reopen within the same press. The returned guard swallows that reopen:
 *
 *   const allowOpenChange = useTriggerToggle(isOpen, triggerRef);
 *   <AriaSelect onOpenChange={(open) => allowOpenChange(open) && setIsOpen(open)} …
 */
export function useTriggerToggle(isOpen: boolean, triggerRef: RefObject<HTMLElement | null>) {
  const suppressReopenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) return;
      suppressReopenRef.current = true;
      // Only the next open within this press may be swallowed.
      setTimeout(() => {
        suppressReopenRef.current = false;
      }, 400);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen, triggerRef]);

  return (next: boolean) => {
    if (next && suppressReopenRef.current) {
      suppressReopenRef.current = false;
      return false;
    }
    return true;
  };
}
