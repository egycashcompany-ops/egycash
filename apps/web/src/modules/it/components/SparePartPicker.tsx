// Spare-part reference picker — ADR-019 rule 5, both halves.
//
// It replaces a `pageSize: 100` load feeding a `<select>`. The store is a growth catalog — the
// design lists parts alongside assets and vendors as "ship with `search` from day one" (§12) — so
// the browser never holds it to filter locally. At exactly 101 parts the old control silently
// stopped showing some of them, which is the correctness cliff ADR-019 exists to remove.
//
// The picked part's ON-HAND level comes back with it, because the caller needs that number to stop
// a technician asking for stock the store does not have (FR-9). Resolving by id is what makes that
// possible without holding the catalog.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ItSparePartDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { useItSparePart } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;

export const SparePartPicker = ({
  value,
  onChange,
  ariaLabel,
}: {
  /** The picked part id, '' when none. */
  value: string;
  /** Carries the resolved part too — the caller needs `onHandQty` and `unit`, not just an id. */
  onChange: (partId: string, part: ItSparePartDto | null) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('itSparePart.view');

  const results = useQuery({
    queryKey: listKey('it', 'spareParts', { picker: search }),
    queryFn: () => api.listSpareParts({ search, active: true, pageSize: PAGE_SIZE }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useItSparePart(allowed ? value : '');

  if (!allowed) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.parts.noAccess')}</p>;
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            {picked.data === undefined
              ? picked.isError
                ? t('it.parts.pickedUnresolved')
                : t('common.loading')
              : `${picked.data.name} — ${String(picked.data.onHandQty)} ${picked.data.unit}`}
          </span>
          <button
            type="button"
            onClick={() => onChange('', null)}
            aria-label={t('it.parts.clearPick')}
            title={t('it.parts.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.parts.pickerPlaceholder')}
        placeholder={t('it.parts.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.parts.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((part) => (
                <li key={part.id}>
                  <button
                    type="button"
                    aria-pressed={part.id === value}
                    onClick={() => {
                      onChange(part.id, part);
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                      part.id === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{part.name}</span>
                    <span className="font-mono text-xs text-slate-500" dir="ltr">
                      {part.onHandQty} {part.unit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
