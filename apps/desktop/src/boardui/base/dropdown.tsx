// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/dropdown/dropdown.tsx.
// Tayfa changes: imports only.
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from 'react-aria-components';
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_INTERACTIVE,
  MENU_POPOVER_SURFACE,
  MENU_POPOVER_WIDTH,
} from '@boardui/base/menu-styles';
import { cx } from '@boardui/foundations/cx';
import {
  useDismissOnOutsidePress,
  useTriggerToggle,
} from '@boardui/foundations/use-dismiss-on-outside-press';

/**
 * The BoardUI popover menu as composable primitives on React Aria DialogTrigger/Popover: a free-form
 * surface of grouped action rows (unlike Select, which puts a value into its trigger).
 *
 *   <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
 *     <DropdownTrigger>…</DropdownTrigger>
 *     <DropdownPopover aria-label={t('İşlemler')} placement="bottom start">
 *       <DropdownGroup label={t('Ekle')}>
 *         <DropdownItem onSelect={close}>…</DropdownItem>
 *       </DropdownGroup>
 *       <DropdownDivider />
 *     </DropdownPopover>
 *   </Dropdown>
 *
 * The popover is non-modal (no scroll lock); outside-press dismissal is restored here.
 */

interface DropdownContextValue {
  triggerRef: RefObject<HTMLButtonElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

export interface DropdownProps {
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  /** Trigger (a DropdownTrigger) followed by a DropdownPopover. */
  children: ReactNode;
}

export function Dropdown({ isOpen: controlledOpen, onOpenChange, children }: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useDismissOnOutsidePress(isOpen, () => setOpen(false), [triggerRef, popoverRef]);
  // Pressing the trigger while open closes the menu instead of reopening it.
  const allowOpenChange = useTriggerToggle(isOpen, triggerRef);

  return (
    <DropdownContext.Provider value={{ triggerRef, popoverRef }}>
      <AriaDialogTrigger
        isOpen={isOpen}
        onOpenChange={(open) => allowOpenChange(open) && setOpen(open)}
      >
        {children}
      </AriaDialogTrigger>
    </DropdownContext.Provider>
  );
}

/** The element that opens the menu. Style it entirely via className. */
export function DropdownTrigger({ className, ...props }: ComponentProps<typeof AriaButton>) {
  const context = useContext(DropdownContext);
  return (
    <AriaButton
      ref={context?.triggerRef}
      {...props}
      className={cx(
        'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
        className as string,
      )}
    />
  );
}

export interface DropdownPopoverProps extends Pick<
  ComponentProps<typeof AriaPopover>,
  'placement' | 'offset' | 'crossOffset'
> {
  'aria-label': string;
  /** Extra classes on the panel, e.g. a width override (default w-[266px]). */
  className?: string;
  /** Classes on the inner dialog (the flex column), e.g. gap between groups. */
  dialogClassName?: string;
  children: ReactNode;
}

export function DropdownPopover({
  'aria-label': ariaLabel,
  placement = 'bottom start',
  offset = 4,
  crossOffset,
  className,
  dialogClassName,
  children,
}: DropdownPopoverProps) {
  const context = useContext(DropdownContext);
  return (
    <AriaPopover
      ref={context?.popoverRef}
      isNonModal
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, className)}
    >
      {/* gap-1 keeps bare rows 4px apart, the Select listbox rhythm. */}
      <AriaDialog
        aria-label={ariaLabel}
        className={cx('flex flex-col gap-1 outline-none', dialogClassName)}
      >
        {children}
      </AriaDialog>
    </AriaPopover>
  );
}

export interface DropdownGroupProps {
  /** Muted body-medium heading above the rows. */
  label?: string;
  className?: string;
  children: ReactNode;
}

export function DropdownGroup({ label, className, children }: DropdownGroupProps) {
  return (
    // pt-1 spaces the label; a group without one must not carry it.
    <div className={cx('flex w-full flex-col gap-1.5', label && 'pt-1', className)}>
      {label && <span className="ps-2 text-body-medium text-text-secondary">{label}</span>}
      <div className="flex w-full flex-col gap-1">{children}</div>
    </div>
  );
}

export interface DropdownItemProps {
  /** Highlights the row like the hover state (current selection). */
  selected?: boolean;
  onSelect?: () => void;
  /** Row padding defaults to p-2; override for denser rows (px-2 py-1.5). */
  className?: string;
  children: ReactNode;
}

/** A menu row with free-form content laid out in a gap-2 flex row. */
export function DropdownItem({ selected, onSelect, className, children }: DropdownItemProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(MENU_ITEM, selected ? MENU_ITEM_ACTIVE : MENU_ITEM_INTERACTIVE, className)}
    >
      {children}
    </button>
  );
}

/** Full-bleed 1px divider between groups (bleeds through the panel's p-2.5). */
export function DropdownDivider({ className }: { className?: string }) {
  return <div className={cx('-mx-2.5 my-1.5 h-px shrink-0 bg-border-button-default', className)} />;
}
