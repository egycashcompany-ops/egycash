// «البيانات المرجعية»'s toolbar (Round 34 B) — the boards' dark filter bar over a searchable kind:
// the search box, «الحالة» (الكل / مُفعَّل / غير مُفعَّل), on the branches «البنك», and at the row's
// end the reset (the bar's own, shown once something narrows) and how many rows the answer holds
// («1,340 نتيجة»). The rules — what each control writes to the address bar and what the server is
// asked — are `lib/catalog-filters.ts`; this file only draws them.
//
// THE SEARCH BOX is the shared `SearchInput`'s look (the magnifier at the reading start, the ✕ at
// the end) with three things that control does not do and this screen needs: Escape empties it,
// a change made elsewhere (the reset, a filter, another kind, the back button) drops a search
// still waiting to be sent instead of sending it a moment later, and what it does is a pure,
// tested model (`createSearchBox`, its clock `createSearchDebounce`) rather than effects no suite
// here can run — this file only hands it the keys and the address bar.
//
// THE COUNT says what the answer holds, «جارٍ التحميل…» while the first one is on its way, and «—»
// (named «تعذّر التحميل») when the read failed — never «loading» beside a table that says it failed.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { type OperationsBankDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { pluralKey } from '../../../shared/lib/plural';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon, SearchIcon } from '../../../shared/ui/icons';
import { DARK_FILTER_BAR, pickOne } from '../../fleet/components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { NUM } from '../../fleet/components/FuelCardBoard';
import {
  CATALOG_SEARCH_DEBOUNCE_MS,
  createSearchBox,
  searchBoxContext,
  searchBoxKey,
  type CatalogFilters,
  type CatalogKind,
  type CatalogStatusFilter,
} from '../lib/catalog-filters';
import { catalogFigure } from './CatalogKindCards';
import { SHIPMENT_PATH } from './shipment-icons';

/** Every box of the bar is `tight`, as on the boards. */
const TIGHT = 'tight' as const;

/** The value a list's «الكل» stands for — never sent, never in the address bar. */
const ALL = 'all';

/**
 * The search box. `value` is the address bar's `q` and `context` the rest of its narrowing
 * (`searchBoxContext`); `onSearch` is called once the reader pauses (`CATALOG_SEARCH_DEBOUNCE_MS`),
 * or at once on ✕ / Escape. What it does is `createSearchBox`'s.
 */
export const CatalogSearchBox = ({
  value,
  context,
  onSearch,
  placeholder,
}: {
  value: string;
  context: string;
  onSearch: (text: string) => void;
  placeholder: string;
}): JSX.Element => {
  const t = useT();
  const [text, setText] = useState(value);
  const latest = useRef(onSearch);
  latest.current = onSearch;
  const [box] = useState(() =>
    createSearchBox(CATALOG_SEARCH_DEBOUNCE_MS, (next) => latest.current(next), { value, context }),
  );
  useEffect(() => () => box.cancel(), [box]);
  // The address bar, back: a change made elsewhere replaces what is in the box.
  useEffect(() => {
    const shown = box.sync(value, context);
    if (shown !== null) setText(shown);
  }, [value, context, box]);

  const type = (next: string): void => {
    setText(next);
    box.type(next);
  };
  const clear = (): void => {
    setText('');
    box.clear();
  };

  return (
    // `[&&>input]:!px-9` outranks the dark bar's own laptop padding for its boxes (a single `&`,
    // `!px-1.5` from 1024 to 1279px), which would put the magnifier and the ✕ over the text.
    <div className="relative [&&>input]:!px-9">
      <span className="pointer-events-none absolute inset-y-0 start-0 z-[1] flex items-center ps-3 text-slate-400">
        <SearchIcon className="h-4 w-4" />
      </span>
      <input
        type="search"
        value={text}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (searchBoxKey(e.key, text) === 'clear') {
            // The box's own Escape only — a dialog behind it is not closed by it.
            e.preventDefault();
            e.stopPropagation();
            clear();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        data-catalog-search="true"
        // The browser's own ✕ hidden — the box draws its own (as `SearchInput` does).
        className="h-9 w-full rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {text !== '' && (
        <button
          type="button"
          onClick={clear}
          data-catalog-search-clear="true"
          className="absolute inset-y-0 end-0 z-[1] flex items-center pe-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label={t('operations.catalogs.empty.clearSearch')}
          title={t('operations.catalogs.empty.clearSearch')}
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};

/**
 * A phrase holding a count — «1,340 نتيجة» — with the count in the boards' figures, isolated left
 * to right. The catalog's own forms decide the words («نتيجة واحدة», «نتيجتان» name no number).
 */
export const CountPhrase = ({
  phraseKey,
  count,
}: {
  phraseKey: string;
  count: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  // A mark no catalog text holds stands in for the count, so the words around it are cut out whole.
  const MARK = '⁣';
  const [before = '', after] = t(pluralKey(phraseKey, locale, count), { count: MARK }).split(MARK);
  return (
    <>
      {before}
      {after !== undefined && (
        <>
          <bdi dir="ltr" className={cn('font-black text-slate-900 dark:text-white', NUM)}>
            {catalogFigure(count)}
          </bdi>
          {after}
        </>
      )}
    </>
  );
};

export const CatalogToolbar = ({
  kind,
  filters,
  banks,
  results,
  failed = false,
  refreshing,
  onSearch,
  onFilters,
  onReset,
  active,
}: {
  kind: CatalogKind;
  filters: CatalogFilters;
  /** The bank filter's choices — the branches kind only. */
  banks: readonly OperationsBankDto[];
  /** How many rows the answer holds, or null before the first answer. */
  results: number | null;
  /** The list's read failed — the table says so, and the count is not «loading». */
  failed?: boolean;
  /** A new answer is on its way while the last one stays on screen. */
  refreshing: boolean;
  onSearch: (text: string) => void;
  onFilters: (updates: { status?: CatalogStatusFilter; bank?: string }) => void;
  onReset: () => void;
  /** Something narrows the list — the reset is offered. */
  active: boolean;
}): JSX.Element => {
  const t = useT();
  const statusValue = [filters.status === '' ? ALL : filters.status];
  const bankValue = [filters.bank === '' ? ALL : filters.bank];
  const shown = failed ? null : results;
  const trailing: ReactNode = (
    <span
      role="status"
      data-catalog-results={shown ?? ''}
      {...(failed ? { 'data-catalog-results-failed': 'true' } : {})}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600 dark:border-slate-700/80 dark:bg-[#080C14] dark:text-slate-300"
    >
      {refreshing && !failed && (
        <span data-catalog-refreshing="true" aria-label={t('common.loading')}>
          <Spinner className="h-3.5 w-3.5 text-brand-500" />
        </span>
      )}
      {failed ? (
        <span aria-label={t('common.error.title')} title={t('common.error.title')}>
          —
        </span>
      ) : shown === null ? (
        t('common.loading')
      ) : (
        <CountPhrase phraseKey="operations.catalogs.results" count={shown} />
      )}
    </span>
  );

  return (
    <div
      className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}
      data-catalog-toolbar={kind}
    >
      <FilterBar hasActiveFilters={active} onClear={onReset} trailing={trailing}>
        {/* ONE child for the bar's row: the dark bar shares its row evenly among its children, and
          a search box is worth more than a status. Inside, each box keeps its own width — on a
          phone the search takes the line and the two lists share the next. */}
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-1 sm:flex-wrap sm:items-center">
          <div className="col-span-2 sm:w-80 xl:w-96">
            <CatalogSearchBox
              // A fresh box for each kind: a search typed on one is never sent to the next.
              key={kind}
              value={filters.q}
              context={searchBoxContext(filters)}
              onSearch={onSearch}
              placeholder={t(`operations.catalogs.search.${kind}`)}
            />
          </div>
          {kind === 'branches' && (
            <FilterWithIcon
              icon={SHIPMENT_PATH.bank}
              tone="text-violet-600 dark:text-violet-300"
              className="min-w-0 sm:w-52"
            >
              <div data-catalog-bank-filter="true">
                <MultiSelect
                  fullWidth
                  density={TIGHT}
                  showSelectedValues
                  label={t('operations.catalogs.filter.bank')}
                  options={[
                    { value: ALL, label: t('operations.catalogs.filter.allBanks') },
                    ...banks.map((bank) => ({ value: bank.id, label: bank.opsName })),
                  ]}
                  value={bankValue}
                  onChange={(next) => {
                    const picked = pickOne(bankValue, next) ?? ALL;
                    onFilters({ bank: picked === ALL ? '' : picked });
                  }}
                />
              </div>
            </FilterWithIcon>
          )}
          <FilterWithIcon
            icon={FILTER_ICON.status}
            tone="text-emerald-600 dark:text-emerald-400"
            className={cn('min-w-0 sm:w-44', kind !== 'branches' && 'col-span-2 sm:col-span-1')}
          >
            <div data-catalog-status-filter="true">
              <MultiSelect
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('operations.catalogs.filter.status')}
                options={[
                  { value: ALL, label: t('operations.catalogs.filter.statusAll') },
                  { value: 'active', label: t('operations.common.active') },
                  { value: 'inactive', label: t('operations.common.inactive') },
                ]}
                value={statusValue}
                onChange={(next) => {
                  const picked = pickOne(statusValue, next) ?? ALL;
                  onFilters({ status: picked === ALL ? '' : (picked as CatalogStatusFilter) });
                }}
              />
            </div>
          </FilterWithIcon>
        </div>
      </FilterBar>
    </div>
  );
};
