// Layout container for a screen's filter controls (search, selects, date ranges…). Presents a
// consistent bar and a reset affordance shown only when filters are actually active.
//
// Reset is an ICON, and a coloured one. The old text button sat in a row of grey controls and read
// as one more filter rather than the way out of them — and "clear" next to a list of filters is
// ambiguous about which one it clears. An amber circular-arrow is unmistakably "undo all of this",
// and it stays labelled for screen readers and on hover.
import { createContext, type ReactNode, useContext } from 'react';
import { cn } from '../lib/cn';
import { useT } from '../../platform/localization/useT';
import { ResetIcon } from './icons';

const singleRowBreakpoint: Record<1280 | 1400 | 1440 | 1536, string> = {
  // The narrowest desktop the product targets. Only for a bar whose children SHARE the width
  // (`flex-1 min-w-0`) rather than each demanding its own: those shrink to fit, so the row cannot
  // be pushed off the page however many controls it holds. A bar of fixed-width children must
  // still measure and pick a threshold past the width it actually needs.
  1280: 'min-[1280px]:flex-nowrap',
  1400: 'min-[1400px]:flex-nowrap',
  1440: 'min-[1440px]:flex-nowrap',
  1536: 'min-[1536px]:flex-nowrap',
};

/**
 * How a module wants its reset. The default is the app's: amber, and shown only once a filter is
 * set. Fleet asks for «زرار ريست … يكون لونه احمر ويكون قبل رقم الفلاتر» — red, and (being the
 * first thing in the trailing group) before the count. `always` keeps it on screen, off while
 * nothing is filtered, for a module that wants it there regardless.
 */
export interface FilterResetStyle {
  tone: 'amber' | 'red';
  always: boolean;
}
export const FilterResetStyleContext = createContext<FilterResetStyle>({
  tone: 'amber',
  always: false,
});

/** The reset's own colours — shared with the boards that draw their reset themselves. */
export const filterResetTone = (tone: FilterResetStyle['tone']): string =>
  tone === 'red'
    ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-900 focus:ring-red-400 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900'
    : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-900 focus:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900';

export const FilterBar = ({
  children,
  onClear,
  hasActiveFilters = false,
  trailing,
  singleRow = false,
  singleRowFrom = 1400,
}: {
  children: ReactNode;
  onClear?: () => void;
  hasActiveFilters?: boolean;
  /**
   * Something that belongs at the END of the row, after the reset — a row count, a summary. It
   * sits at the end whether or not the reset is showing, so a count does not jump sideways the
   * moment a filter is cleared.
   */
  trailing?: ReactNode;
  /**
   * Keep every filter on ONE row on a wide screen, wrapping only on narrower ones.
   *
   * Off by default, because wrapping is the right answer for a bar whose controls are wide or
   * whose count varies. Turn it on in one of TWO shapes, and the choice decides the threshold:
   *
   *   • FIXED children — each carries its own width and `shrink-0`. The row cannot shorten, so
   *     the threshold must be measured past the width the row actually needs, or `flex-nowrap`
   *     pushes it off the page instead of wrapping it.
   *   • SHARED children — each carries `flex-1 min-w-0` and a `basis`. They divide whatever the
   *     bar has, so the row always fits and the threshold is simply the narrowest screen on
   *     which the controls are still worth reading. The drivers registry holds eleven this way.
   *
   * The threshold is 1400px of VIEWPORT rather than a named breakpoint, and it is measured, not
   * chosen: `flex-nowrap` does not shorten a row that will not fit, it pushes it off the page, so
   * the point where it turns on has to be past the point where the row fits. A five-filter bar
   * measures 1038px in English, and the shell spends 304px of the viewport before the bar begins
   * (a 240px sidebar and the page's own 2rem gutters) — so it fits from 1342px, and `lg` (1024)
   * or `xl` (1280) would each have traded a tidy wrap for a horizontally scrolling page. The
   * remaining 58px is headroom for a longer translation.
   */
  singleRow?: boolean;
  /**
   * The viewport width at which `singleRow` starts holding. MEASURE IT — the default is right for
   * the five-filter bar described above and for nothing else, because `flex-nowrap` does not
   * shorten a row that will not fit, it pushes it off the page. A bar with more controls, or with
   * a larger type size, fits later and must say so: a threshold below where the row actually fits
   * trades a tidy wrap for a horizontally scrolling page, which is strictly worse than wrapping.
   *
   * Spelled out rather than interpolated because Tailwind scans source text for class names and
   * never sees a built string.
   */
  singleRowFrom?: 1280 | 1400 | 1440 | 1536;
}): JSX.Element => {
  const t = useT();
  const reset = useContext(FilterResetStyleContext);
  const showReset = onClear !== undefined && (hasActiveFilters || reset.always);
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900',
        singleRow && singleRowBreakpoint[singleRowFrom],
      )}
    >
      {children}
      {(showReset || trailing !== undefined) && (
        // ON THE CONTROLS' LINE, CENTRED IN IT — «العدد بتاع الفلاتر يكون ف النص بحيث يكون زى
        // الفلاتر على صف واحد». Every `FilterField` writes its question ABOVE its control, so a
        // filter child is a label plus a box while this group is a 36px button and a short badge.
        // Centred against the whole child it floated up level with the LABELS; bottom-aligned it
        // sat on the boxes' lower edge. Both read as a second row.
        //
        // So the group is given the CONTROL's own height and centres inside it: `h-9` is what
        // `FilterField` leaves under its label, and `self-end` puts that box on the controls' line
        // rather than the labels'. The badge then sits in the middle of a filter box, which is
        // where the eye already is.
        <div className="ms-auto flex h-9 shrink-0 items-center gap-2 self-end">
          {showReset && (
            <button
              type="button"
              onClick={onClear}
              disabled={!hasActiveFilters}
              aria-label={t('common.filters.clear')}
              title={t('common.filters.clear')}
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus:ring-2 disabled:cursor-default disabled:opacity-50',
                filterResetTone(reset.tone),
              )}
            >
              <ResetIcon className="h-4 w-4" />
            </button>
          )}
          {trailing}
        </div>
      )}
    </div>
  );
};
