// Vendor reference picker — ADR-019 rule 5, both halves.
//
// **Search to choose.** Vendors are a growth catalog, so typing queries the server; the browser
// never holds the catalog to filter it.
//
// **Resolve by id to display.** A form arriving with a stored `purchase.vendorId` has an id and no
// search text, and still has to show a name. `GET /it/vendors/:id` answers exactly that, and it
// deliberately resolves ARCHIVED vendors too — the id being resolved usually belongs to an older
// asset, and FR-11 archives rather than deletes precisely so those references keep rendering.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { useItVendor } from '../api/it-queries';
import * as api from '../api/it-api';

const PAGE_SIZE = 8;

export const VendorPicker = ({
  value,
  onChange,
  ariaLabel,
}: {
  /** The picked vendor id, '' when none. */
  value: string;
  onChange: (vendorId: string) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [search, setSearch] = useState('');
  const allowed = can('itVendor.view');

  const results = useQuery({
    queryKey: listKey('it', 'vendors', { picker: search }),
    queryFn: () => api.listVendors({ search, isActive: true, pageSize: PAGE_SIZE }),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useItVendor(value, allowed);

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.vendors.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">
            {picked.data?.name ?? (picked.isError ? t('it.vendors.pickedUnresolved') : t('common.loading'))}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('it.vendors.clearPick')}
            title={t('it.vendors.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.vendors.pickerPlaceholder')}
        placeholder={t('it.vendors.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.vendors.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((vendor) => (
                <li key={vendor.id}>
                  <button
                    type="button"
                    aria-pressed={vendor.id === value}
                    onClick={() => {
                      onChange(vendor.id);
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                      vendor.id === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span>{vendor.name}</span>
                    {vendor.code !== null && (
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {vendor.code}
                      </span>
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
