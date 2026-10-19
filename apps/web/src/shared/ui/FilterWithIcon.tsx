// «حطلى فى الفلاتر ايقونات»: each filter of a dark filter bar carries a small icon at its start, as
// the Fleet charging screen's car filter did first — the box itself keeps its text, the icon says
// what it is. Shared so any module's bar can wear it; Fleet's own frame (`fleet/components/
// FilterWithIcon`) draws through this one and adds its date boxes' calendar button.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { StrokeIcon } from './StrokeIcon';

/**
 * A filter with its icon. The icon sits over the control's start edge and the control's text is
 * pushed past it — the box keeps its size, its value and its list.
 *
 * The icon is a picture the clicks pass through to the control under it, unless `adornment` takes
 * its place — something pressable drawn in the same gutter (Fleet's calendar button).
 */
export const FilterWithIcon = ({
  icon,
  tone = 'text-slate-500 dark:text-slate-400',
  className,
  adornment,
  children,
}: {
  icon: readonly string[];
  /** The icon's colour. */
  tone?: string;
  className?: string;
  /** Drawn in the icon's place, in the same gutter — for an icon that is a button. */
  adornment?: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  <div
    className={cn(
      'relative',
      // The control's own text starts after the icon — the trigger of a list, or a typed box. On
      // the PAGE's start side: a code or a chassis box is written left to right inside an Arabic
      // page, so its own «start» is the wrong side for the icon.
      //
      // Doubled (`&&`) so the gutter outranks a bar's own padding for its boxes: the dark bar's
      // 1024–1279 `[&_input]:!px-1.5` is just as specific as a single `&` and comes later, and
      // took the gap away from every icon filter — the icon over the plate's text, over the
      // notices' «من», over a date's first digit. Nowhere else does anything compete with it.
      'rtl:[&&_button[aria-haspopup]]:!pr-6 ltr:[&&_button[aria-haspopup]]:!pl-6',
      'rtl:[&&>input]:!pr-6 rtl:[&&>input]:!pl-1.5 ltr:[&&>input]:!pl-6 ltr:[&&>input]:!pr-1.5',
      className,
    )}
  >
    {children}
    {adornment ?? (
      <span className="pointer-events-none absolute start-0 top-0 z-[1] flex h-9 items-center ps-2">
        <StrokeIcon d={icon} className={cn('h-3.5 w-3.5', tone)} />
      </span>
    )}
  </div>
);
