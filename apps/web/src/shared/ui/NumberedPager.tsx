// The numbered pager the Fleet screens wear first («عاوز اخلى بتاع الصفحات دا فى كل الشاشات اللى
// بيبقى فيها يتغير ل كدا»): «عرض 1 - 8 من أصل 48» on one side, the page numbers in the middle — the
// current one in the site's purple, the far ones folded into «…» — and «الصفوف بالصفحة» on the
// other side. Shared since another module's screen wears it too (/atm/machines, a hundred pages
// deep); Fleet draws through it (`fleet/components/FleetPager`) with its own words and mark.
//
// The same props as the shared `Pagination`, so a screen swaps one import for the other. That
// pager stays as it is for the rest of the application.
import { type PageMeta } from '@ecms/contracts';
import { useT } from '../../platform/localization/useT';
import { cn } from '../lib/cn';
import { ChevronEndIcon, ChevronStartIcon } from './icons';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/**
 * The page numbers to draw: every page when there are seven or fewer, otherwise the first, the
 * last and the current one with its neighbours, a `null` standing for each folded run.
 */
export const pagerPages = (page: number, totalPages: number): (number | null)[] => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const near = [page - 1, page, page + 1].filter((p) => p > 1 && p < totalPages);
  if (page <= 3) near.push(2, 3, 4);
  if (page >= totalPages - 2) near.push(totalPages - 3, totalPages - 2, totalPages - 1);
  const middle = [...new Set(near)].filter((p) => p > 1 && p < totalPages).sort((a, b) => a - b);
  const out: (number | null)[] = [1];
  let last = 1;
  for (const p of middle) {
    if (p > last + 1) out.push(null);
    out.push(p);
    last = p;
  }
  if (totalPages > last + 1) out.push(null);
  out.push(totalPages);
  return out;
};

/** What the pager says, as translation keys — a module that wore it first keeps its own. */
export interface PagerWords {
  showingBefore: string;
  showingOf: string;
  perPage: string;
  label: string;
}

const COMMON_WORDS: PagerWords = {
  showingBefore: 'common.pager.showing.before',
  showingOf: 'common.pager.showing.of',
  perPage: 'common.pager.perPage',
  label: 'common.pager.label',
};

const SQUARE =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-bold tabular-nums transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40';
const IDLE =
  'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700/80 dark:bg-[#0c121e] dark:text-slate-300 dark:hover:bg-slate-800';
/**
 * The current page: the site's purple — the custody screen too («لا بنفسجى») — or emerald on the
 * fuel cards and fuel charging boards, which ask for it.
 */
const CURRENT = {
  brand: 'border-brand-500 bg-brand-600 text-white shadow-md shadow-brand-700/40',
  emerald: 'border-emerald-500 bg-emerald-600 text-white shadow-md shadow-emerald-700/40',
} as const;

export const NumberedPager = ({
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  tone = 'brand',
  words = COMMON_WORDS,
  mark = 'pager',
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  tone?: keyof typeof CURRENT;
  words?: PagerWords;
  /** The pager's `data-*` attribute (`data-<mark>="true"`), by which a suite finds it. */
  mark?: string;
}): JSX.Element => {
  const t = useT();
  const { page, pageSize, totalItems, totalPages } = meta;
  const pages = Math.max(1, totalPages);
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);
  const strong = 'font-black text-slate-900 dark:text-white';

  return (
    <div
      {...{ [`data-${mark}`]: 'true' }}
      className="flex flex-col items-center justify-between gap-3 py-3 text-xs sm:flex-row"
    >
      <span className="text-slate-500 dark:text-slate-400">
        {t(words.showingBefore)}{' '}
        <span className={strong} dir="ltr">
          {from} - {to}
        </span>{' '}
        {t(words.showingOf)} <span className={strong}>{totalItems}</span>
      </span>

      <nav aria-label={t(words.label)} className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t('common.pagination.prev')}
          className={cn(SQUARE, IDLE)}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronStartIcon className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
        {pagerPages(page, pages).map((p, index) =>
          p === null ? (
            <span key={`gap-${index}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              data-pager-page={p}
              className={cn(SQUARE, p === page ? CURRENT[tone] : IDLE)}
              onClick={() => {
                if (p !== page) onPageChange(p);
              }}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label={t('common.pagination.next')}
          className={cn(SQUARE, IDLE)}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          <ChevronEndIcon className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
      </nav>

      {onPageSizeChange === undefined ? (
        <span />
      ) : (
        <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          {t(words.perPage)}
          <select
            aria-label={t(words.perPage)}
            data-page-size
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 dark:border-slate-700/80 dark:bg-[#0c121e] dark:text-slate-200"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
};
