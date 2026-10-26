// Adapted from the BoardUI free tier (MIT, see ../LICENSE): components/base/tabs/tabs.tsx.
// Tayfa changes: imports; direction from React Aria's locale; the selected tab uses Tayfa's accent
// text token (the 600 fill shade is too dark on Tayfa's dark surfaces) and the idle count a surface
// token instead of black/10.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode, Ref } from 'react';
import { useLocale } from 'react-aria';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
} from 'react-aria-components';
import type {
  TabListProps as AriaTabListProps,
  TabPanelProps as AriaTabPanelProps,
  TabProps as AriaTabProps,
  TabsProps as AriaTabsProps,
} from 'react-aria-components';
import { cx } from '@boardui/foundations/cx';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Underline tabs. The strip sits on a 1px separator; the active tab paints a 2px accent underline.
 *   tab    px 10, py 8, gap 10 (label to count), Body (14/20); active: accent text, Medium
 *   count  radius 4, px 4, py 1, Caption 1/Medium
 *   icon   optional 16px leading glyph in the label colour
 * React Aria Tabs: roving tabindex, arrow keys, automatic activation, TabList/TabPanel wiring.
 */

type IconComponent = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface TabsProps extends AriaTabsProps {
  ref?: Ref<HTMLDivElement>;
}

export function Tabs({ className, ref, ...props }: TabsProps) {
  return (
    <AriaTabs
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          'flex w-full flex-col gap-4',
          state.orientation === 'vertical' && 'flex-row',
          typeof className === 'function' ? className(state) : className,
        )
      }
    />
  );
}

export interface TabListProps<T extends object> extends AriaTabListProps<T> {
  ref?: Ref<HTMLDivElement>;
}

type Underline = { left: number; width: number };

export function TabList<T extends object>({ className, ref, ...props }: TabListProps<T>) {
  const { direction } = useLocale();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [underline, setUnderline] = useState<Underline | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => {
      const selected = el.querySelector<HTMLElement>("[role='tab'][data-selected]");
      if (selected) {
        setUnderline({ left: selected.offsetLeft, width: selected.offsetWidth });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Labels and fonts can change width without resizing the whole strip.
    const observeTabs = () => el.querySelectorAll("[role='tab']").forEach((tab) => ro.observe(tab));
    observeTabs();
    const mo = new MutationObserver(() => {
      observeTabs();
      measure();
    });
    mo.observe(el, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: ['data-selected'],
    });
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [direction]);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <AriaTabList
        ref={ref}
        {...props}
        className={(state) =>
          cx(
            'flex w-full items-center gap-1 border-b border-separator-border',
            typeof className === 'function' ? className(state) : className,
          )
        }
      />
      {underline && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-accent-500 transition-[transform,width] duration-200 ease"
          style={{
            transform: `translateX(${underline.left}px)`,
            width: underline.width,
          }}
        />
      )}
    </div>
  );
}

export interface TabProps extends Omit<AriaTabProps, 'children'> {
  children?: ReactNode;
  /** Optional leading icon (16px). Inherits the label colour. */
  icon?: IconComponent;
  /** Optional trailing count badge. */
  count?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function Tab({ className, children, icon: Icon, count, ref, ...props }: TabProps) {
  return (
    <AriaTab
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          'relative inline-flex cursor-pointer items-center gap-2.5 px-2.5 py-2 whitespace-nowrap',
          'outline-none transition-colors duration-150 ease',
          'focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          state.isDisabled && 'cursor-not-allowed opacity-50',
          typeof className === 'function' ? className(state) : className,
        )
      }
    >
      {({ isSelected }) => (
        <>
          <span
            className={cx(
              'inline-flex items-center gap-1.5',
              isSelected
                ? 'text-body-medium text-text-accent'
                : 'text-body-regular text-text-primary',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
            {children}
          </span>
          {count != null && (
            <span
              className={cx(
                'inline-flex items-center justify-center rounded-sm px-1 py-px text-caption-1-medium whitespace-nowrap',
                isSelected
                  ? 'bg-tab-count-selected-background text-text-accent'
                  : 'bg-background-tertiary-default text-text-secondary',
              )}
            >
              {count}
            </span>
          )}
        </>
      )}
    </AriaTab>
  );
}

export interface TabPanelProps extends AriaTabPanelProps {
  ref?: Ref<HTMLDivElement>;
}

export function TabPanel({ className, ref, ...props }: TabPanelProps) {
  return (
    <AriaTabPanel
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          'outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-border-focus-ring',
          typeof className === 'function' ? className(state) : className,
        )
      }
    />
  );
}
