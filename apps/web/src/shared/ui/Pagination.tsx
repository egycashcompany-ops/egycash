// Pagination controls bound to the API's PageMeta (API Standards §4). RTL-safe (prev/next
// chevrons and the flex row flip together), with a localized "showing X–Y of Z" summary and an
// optional page-size selector.
import { type PageMeta } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../../platform/localization/useT';
import { formatNumber } from '../lib/format';
import { cn } from '../lib/cn';
import { ChevronEndIcon, ChevronStartIcon } from './icons';

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

/**
 * «كم صفًا في الصفحة؟», on its own.
 *
 * Lifted out of `Pagination` so a screen can put the CHOICE somewhere else and still drop the
 * "showing X–Y of Z" sentence — on a board that already prints its own count beside its title,
 * that sentence is a third statement of the same number, at the bottom of a panel whose whole
 * point is that nothing below the board scrolls.
 */
export const PageSizeSelect = ({
  pageSize,
  onChange,
  options = DEFAULT_PAGE_SIZES,
  className,
}: {
  pageSize: number;
  onChange: (pageSize: number) => void;
  options?: number[];
  className?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <label className={cn('flex items-center gap-1.5 text-sm', className)}>
      <span className="hidden text-slate-500 sm:inline dark:text-slate-400">
        {t('common.pagination.perPage')}
      </span>
      <select
        aria-label={t('common.pagination.perPage')}
        data-page-size
        value={pageSize}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {formatNumber(n, locale)}
          </option>
        ))}
      </select>
    </label>
  );
};

export const Pagination = ({
  meta,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  summary = true,
}: {
  meta: PageMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /**
   * The "showing X–Y of Z" sentence and the per-page box beside it. On by default; a screen that
   * has moved the page-size choice elsewhere (see `PageSizeSelect`) turns it off and is left with
   * just the pager.
   */
  summary?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { page, pageSize, totalItems, totalPages } = meta;
  const from = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  const btn =
    'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

  return (
    <div className="flex flex-col items-center justify-between gap-3 py-3 text-sm sm:flex-row">
      {summary ? (
        <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
          <span>
            {t('common.pagination.showing', {
              from: formatNumber(from, locale),
              to: formatNumber(to, locale),
              total: formatNumber(totalItems, locale),
            })}
          </span>
          {onPageSizeChange !== undefined && (
            <PageSizeSelect
              pageSize={pageSize}
              onChange={onPageSizeChange}
              options={pageSizeOptions}
            />
          )}
        </div>
      ) : (
        // Holds the pager on the far side of the row, the way the summary used to — without it a
        // `justify-between` row with one child centres the pager under the board.
        <span />
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={btn}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
          <span className="hidden sm:inline">{t('common.pagination.prev')}</span>
        </button>
        <span className={cn('px-2 text-slate-600 dark:text-slate-300')}>
          {t('common.pagination.page', {
            page: formatNumber(page, locale),
            total: formatNumber(Math.max(1, totalPages), locale),
          })}
        </span>
        <button
          type="button"
          className={btn}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <span className="hidden sm:inline">{t('common.pagination.next')}</span>
          <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
        </button>
      </div>
    </div>
  );
};
