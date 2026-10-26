// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/select/select.tsx.
// Tayfa changes: imports only.
import { createContext, useContext, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import {
  Button as AriaButton,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
} from 'react-aria-components';
import type {
  ListBoxItemProps as AriaListBoxItemProps,
  SelectProps as AriaSelectProps,
  SelectValueRenderProps as AriaSelectValueRenderProps,
} from 'react-aria-components';
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
  MENU_POPOVER_SURFACE,
  MENU_POPOVER_WIDTH,
} from '@boardui/base/menu-styles';
import { ChevronDownSmall } from '@boardui/foundations/chevrons';
import { cx } from '@boardui/foundations/cx';
import {
  useDismissOnOutsidePress,
  useTriggerToggle,
} from '@boardui/foundations/use-dismiss-on-outside-press';

/**
 * Select with a button trigger (border, shadow/xs, px 10 py 8, radius 10, Body/Medium, 16px chevron)
 * and the shared BoardUI menu popover. Item content is free-form.
 */

export type SelectSize = 'sm' | 'md';

const SelectSizeContext = createContext<SelectSize>('md');

export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children'> {
  /** Trigger width. Defaults to hug content; the menu uses the shared 266px width. */
  className?: string;
  triggerClassName?: string;
  /** Classes for the open popover (e.g. constrain its width). */
  popoverClassName?: string;
  /** `md` (default) or `sm` for dense contexts. */
  size?: SelectSize;
  children: ReactNode;
  items?: Iterable<T>;
  /** Customise the trigger's rendered value; falls back to the selected item's content. */
  renderValue?: ReactNode | ((values: AriaSelectValueRenderProps<T>) => ReactNode);
  ref?: Ref<HTMLDivElement>;
}

export function Select<T extends object>({
  className,
  triggerClassName,
  popoverClassName,
  size = 'md',
  children,
  items,
  renderValue,
  ref,
  ...props
}: SelectProps<T>) {
  // Non-modal popover: the modal scroll lock would move the page. Non-modal also drops React Aria's
  // outside-press dismissal, so open state is controlled here and dismissal restored manually.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  useDismissOnOutsidePress(isOpen, () => setIsOpen(false), [triggerRef, popoverRef]);
  // Pressing the trigger while open closes the popover instead of reopening it.
  const allowOpenChange = useTriggerToggle(isOpen, triggerRef);

  return (
    <AriaSelect
      ref={ref}
      {...props}
      isOpen={isOpen}
      onOpenChange={(open) => allowOpenChange(open) && setIsOpen(open)}
      className={cx('group flex flex-col', className)}
    >
      {({ isOpen }) => (
        <>
          <AriaButton
            ref={triggerRef}
            className={cx(
              'flex w-full cursor-pointer items-center justify-between rounded-2lg',
              'border border-border-button-default bg-background-primary-default shadow-xs',
              'text-text-primary',
              'transition-[background-color,border-color,box-shadow,padding,font-size] duration-200 ease',
              'hover:bg-background-primary-hover hover:border-border-button-hover',
              'outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring',
              'disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none',
              size === 'sm'
                ? 'gap-1 px-[7px] py-1 text-body-2-medium'
                : 'gap-1.5 px-2.5 py-2 text-body-medium',
              triggerClassName,
            )}
          >
            <AriaSelectValue
              className={cx(
                'flex min-w-0 items-center truncate',
                size === 'sm' ? 'gap-1' : 'gap-[5px]',
              )}
            >
              {renderValue as never /* React Aria accepts a node or a render prop */}
            </AriaSelectValue>
            <ChevronDownSmall
              className={cx(
                'shrink-0 text-text-secondary transition-transform duration-200 ease',
                size === 'sm' ? 'size-3.5' : 'size-4',
                isOpen && 'rotate-180',
              )}
            />
          </AriaButton>
          <AriaPopover
            ref={popoverRef}
            isNonModal
            offset={4}
            className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, 'p-2', popoverClassName)}
          >
            <AriaListBox
              items={items}
              className={cx(MENU_ITEMS_CONTAINER, 'max-h-[240px] overflow-auto')}
            >
              <SelectSizeContext.Provider value={size}>{children}</SelectSizeContext.Provider>
            </AriaListBox>
          </AriaPopover>
        </>
      )}
    </AriaSelect>
  );
}

export interface SelectItemProps extends Omit<AriaListBoxItemProps, 'children'> {
  children?: ReactNode;
}

export function SelectItem({ className, children, ...props }: SelectItemProps) {
  const size = useContext(SelectSizeContext);
  return (
    <AriaListBoxItem
      {...props}
      className={(state) =>
        cx(
          MENU_ITEM,
          size === 'sm' ? 'px-2 py-1.5 text-body-2-medium' : 'text-body-medium',
          (state.isFocused || state.isSelected) && MENU_ITEM_ACTIVE,
          state.isDisabled && 'cursor-not-allowed text-text-disabled',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {children}
    </AriaListBoxItem>
  );
}
