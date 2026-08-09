// Asset reference picker — ADR-019 rule 5, both halves.
//
// **Search to choose.** The register grows without bound, so typing queries the server; the
// browser never holds it to filter locally.
//
// **Resolve by id to display.** A form arriving with a stored `assetId` has an id and no search
// text, and still has to show a code and a name. `GET /it/assets/:id` answers exactly that.
//
// Scoped server-side by `itAsset.view`, so a branch-scoped technician searches only their branch —
// the picker adds no filter of its own, because a filter here would be a second, weaker rule.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { useItAsset } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;

export const AssetPicker = ({
  value,
  onChange,
  ariaLabel,
}: {
  /** The picked asset id, '' when none. */
  value: string;
  onChange: (assetId: string) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('itAsset.view');

  const results = useQuery({
    queryKey: listKey('it', 'assets', { picker: search }),
    queryFn: () => api.listAssets({ search, pageSize: PAGE_SIZE }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useItAsset(allowed ? value : '');

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
                ? t('it.assets.pickedUnresolved')
                : t('common.loading')
              : `${picked.data.assetCode} — ${picked.data.name}`}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('it.assets.clearPick')}
            title={t('it.assets.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.assets.pickerPlaceholder')}
        placeholder={t('it.assets.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.assets.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    aria-pressed={asset.id === value}
                    onClick={() => {
                      onChange(asset.id);
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                      asset.id === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{asset.name}</span>
                    <span className="font-mono text-xs text-slate-500" dir="ltr">
                      {asset.assetCode}
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
