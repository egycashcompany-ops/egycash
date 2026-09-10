// One filter in a bar: its NAME above, its VALUE inside.
//
// A filter bar that writes each filter's name INSIDE its own control has to choose between two
// bad things at every width — a box wide enough to spell «صورة الرخصة», or a name clipped to
// «صورة الرخ». Eleven of them and the row is a wall of same-looking boxes whose words are not
// values but questions, so a reader cannot tell a filter that is SET from one that is empty.
//
// Lifting the name out solves both at once. The control below it only ever has to hold an ANSWER
// — «الكل», «سائق أ», a typed fragment — which is short, so every control can be the same width
// and the row gets a rhythm instead of eleven arbitrary sizes. And the name, being ordinary text
// rather than a `<select>`'s longest option, reads in full in far less room than the box needed.
//
// The label also carries the SET state in its colour, which is the cheapest honest signal there
// is: nothing moves, nothing resizes, and a glance along the row says which filters are doing
// something.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

export const FilterField = ({
  label,
  active = false,
  density = 'default',
  className,
  children,
}: {
  /** The filter's name, spelled in full — this is the only place it is written. */
  label: string;
  /** Whether this filter currently narrows the list. Colours the label; changes no geometry. */
  active?: boolean;
  /**
   * The gutter of the CONTROL below, so the name lines up with the value it names.
   *
   * A label at `px-0.5` above a `tight` control at `px-2` starts six pixels outboard of the text
   * it belongs to, and eleven of them side by side made the row of names read as a separate,
   * slightly-misplaced strip above the bar rather than as part of it. Matching the gutter is the
   * whole of the fix, and it changes no width: the label is `truncate` inside a `min-w-0`
   * column, so its padding cannot push the column wider.
   */
  density?: 'default' | 'tight';
  className?: string;
  children: ReactNode;
}): JSX.Element => (
  // The hook is inert markup a test can measure the bar by — one row, equal widths, names that
  // read in full — without reaching for class names that are free to change.
  <div data-filter-field={label} className={cn('flex min-w-0 flex-col gap-1.5', className)}>
    <span
      // The name is VISIBLE, so it needs no tooltip to be discoverable — but it is also
      // `truncate`, and a name cut off by a narrow column has to stay recoverable by pointer.
      title={label}
      className={cn(
        // `truncate` is the honest end of a name too long for its column, and it is why the
        // label may never be the thing a caller sizes the column by.
        //
        // 12px with a real line box, not 11px squeezed to `leading-none`: at eleven-across this
        // strip is the only thing telling a reader what each box is, and `leading-none` crops the
        // Arabic hamza and the descenders that tell «الرخصة» from «الرخصه» at a glance.
        'truncate text-xs font-medium leading-4',
        density === 'tight' ? 'px-2' : 'px-3',
        active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400',
      )}
    >
      {label}
    </span>
    {children}
  </div>
);
