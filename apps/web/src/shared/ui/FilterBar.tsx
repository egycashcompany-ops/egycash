// Layout container for a screen's filter controls (search, selects, date ranges…). Presents a
// consistent bar and a reset affordance shown only when filters are actually active.
//
// Reset is an ICON, and a coloured one. The old text button sat in a row of grey controls and read
// as one more filter rather than the way out of them — and "clear" next to a list of filters is
// ambiguous about which one it clears. An amber circular-arrow is unmistakably "undo all of this",
// and it stays labelled for screen readers and on hover.
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useT } from '../../platform/localization/useT';
import { ResetIcon } from './icons';

export const FilterBar = ({
  children,
  onClear,
  hasActiveFilters = false,
  singleRow = false,
}: {
  children: ReactNode;
  onClear?: () => void;
  hasActiveFilters?: boolean;
  /**
   * Keep every filter on ONE row on a wide screen, wrapping only on narrower ones.
   *
   * Off by default, because wrapping is the right answer for a bar whose controls are wide or
   * whose count varies. Turn it on where the filters are few and deliberately sized, and give each
   * child a width and `shrink-0` — with no wrapping to fall back on, a child left to flex would be
   * squeezed by its neighbours instead of moving to the next line.
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
}): JSX.Element => {
  const t = useT();
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900',
        singleRow && 'min-[1400px]:flex-nowrap',
      )}
    >
      {children}
      {onClear !== undefined && hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('common.filters.clear')}
          title={t('common.filters.clear')}
          className="ms-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <ResetIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
