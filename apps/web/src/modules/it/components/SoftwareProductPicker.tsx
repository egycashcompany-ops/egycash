// Software-product reference picker — ADR-019 rule 5, both halves, from the first commit.
//
// §12 names products alongside assets, vendors and parts as catalogs that "ship with `search` from
// day one", and this is why: the catalogue grows with every piece of software the company installs,
// so the browser never holds it to filter locally.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { useItSoftwareProduct } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;

export const SoftwareProductPicker = ({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (productId: string) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  // Either grant opens the picker, matching the API's read gate: a licence form's product field
  // must populate for whoever manages licences.
  const allowed = can('itSoftware.view') || can('itLicense.view');

  const results = useQuery({
    queryKey: listKey('it', 'software', { picker: search }),
    queryFn: () => api.listSoftwareProducts({ search, active: true, pageSize: PAGE_SIZE }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useItSoftwareProduct(value, allowed);

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.software.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            {picked.data === undefined
              ? picked.isError
                ? t('it.software.pickedUnresolved')
                : t('common.loading')
              : picked.data.name}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('it.software.clearPick')}
            title={t('it.software.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.software.pickerPlaceholder')}
        placeholder={t('it.software.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.software.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    aria-pressed={product.id === value}
                    onClick={() => {
                      onChange(product.id);
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                      product.id === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{product.name}</span>
                    {product.publisher !== null && (
                      <span className="text-xs text-slate-500">{product.publisher}</span>
                    )}
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
