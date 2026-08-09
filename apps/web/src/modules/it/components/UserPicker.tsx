// Platform-user picker, for choosing a technician (ADR-019 rule 5: searched, never loaded).
//
// Reads `/platform/users` — a PLATFORM surface, not another module's, so this stays inside the
// architecture's boundaries the way the branch-options read does. The endpoint is gated by
// `user.view`; without it the picker says so rather than searching into a 403 the user cannot
// interpret.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Spinner } from '../../../shared/ui/Spinner';
import { CloseIcon } from '../../../shared/ui/icons';
import { listKey } from '../../../shared/lib/query-keys';
import { localized } from '../../../shared/lib/format';
import * as api from '../api/it-api';

export const UserPicker = ({
  value,
  valueLabel,
  onChange,
  ariaLabel,
}: {
  value: string;
  valueLabel: string;
  onChange: (userId: string, label: string) => void;
  ariaLabel?: string;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');
  const allowed = can('user.view');

  const results = useQuery({
    queryKey: listKey('it', 'userSearch', search),
    queryFn: () => api.searchUsers(search),
    enabled: allowed && search.trim() !== '',
    staleTime: 30_000,
  });

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.tickets.pickerNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="text-brand-800 dark:text-brand-200">{valueLabel}</span>
          <button
            type="button"
            onClick={() => onChange('', '')}
            aria-label={t('it.tickets.clearPick')}
            title={t('it.tickets.clearPick')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('it.tickets.pickerPlaceholder')}
        placeholder={t('it.tickets.pickerPlaceholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('it.tickets.pickerNoResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((user) => {
                const name = `${localized(user.firstName, locale)} ${localized(user.lastName, locale)}`.trim();
                return (
                  <li key={user.id}>
                    <button
                      type="button"
                      aria-pressed={user.id === value}
                      onClick={() => {
                        onChange(user.id, name);
                        setSearch('');
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800/60 ${
                        user.id === value
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <span>{name}</span>
                      <span className="font-mono text-xs text-slate-500" dir="ltr">
                        {user.email}
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
