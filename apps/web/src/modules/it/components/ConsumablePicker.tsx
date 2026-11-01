// Consumable reference picker — ADR-019 rule 5, both halves, for the issue's lines (FR-20).
//
// **Search to choose.** Every branch keeps its own store, and the stores grow with every new
// cable and toner the IT team stocks, so typing queries the server; the browser never holds the
// items to filter them locally.
//
// **Resolve by id to display.** A line arriving with an id (the register's «صرف» on a row) still
// shows the item's name and what is on hand, through `GET /it/consumables/:id`.
//
// The picked ITEM comes back with its id: the issue needs its on-hand quantity (more than is on
// hand is refused), its unit, and its branch — one memo is one branch's store, so once a line has
// an item the others search that branch only (`branchId`).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ItConsumableDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { formatNumber } from '../../../shared/lib/format';
import { listKey } from '../../../shared/lib/query-keys';
import { useItConsumable } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;

export const ConsumablePicker = ({
  value,
  onChange,
  branchId = '',
  exclude = [],
}: {
  /** The picked item id, '' when none. */
  value: string;
  /** Carries the resolved item too — the caller needs its on-hand quantity, unit and branch. */
  onChange: (consumableId: string, consumable: ItConsumableDto | null) => void;
  /** Search this branch's store only — the branch of the memo's other lines. '' is any branch. */
  branchId?: string;
  /** Items already on the memo — an item is on a memo once. */
  exclude?: readonly string[];
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');
  const allowed = can('itAsset.view');

  const results = useQuery({
    queryKey: listKey('it', 'consumables', { picker: search, branchId }),
    queryFn: () =>
      api.listConsumables({
        search,
        active: true,
        pageSize: PAGE_SIZE,
        ...(branchId === '' ? {} : { branchId }),
      }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useItConsumable(allowed ? value : '');
  const offered = (results.data?.items ?? []).filter((item) => !exclude.includes(item.id));

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.assets.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            {picked.data === undefined
              ? picked.isError
                ? t('it.consumables.pickedUnresolved')
                : t('common.loading')
              : `${picked.data.name} — ${t('it.consumables.onHandNow', {
                  qty: formatNumber(picked.data.onHandQty, locale),
                  unit: picked.data.unit,
                })}`}
          </span>
          <button
            type="button"
            onClick={() => onChange('', null)}
            aria-label={t('it.consumables.clearPick')}
            title={t('it.consumables.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t('it.consumables.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : offered.length === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.consumables.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {offered.map((item) => {
                // Nothing on hand is nothing to issue: shown, so the reader knows the item is
                // there, but not offered.
                const empty = item.onHandQty <= 0;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={item.id === value}
                      disabled={empty}
                      onClick={() => {
                        onChange(item.id, item);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-800/60 ${
                        item.id === value
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate">{item.name}</span>
                        <span className="font-mono text-xs text-slate-500" dir="ltr">
                          {item.code}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                        {empty
                          ? t('it.consumables.nothingOnHand')
                          : `${formatNumber(item.onHandQty, locale)} ${item.unit}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
