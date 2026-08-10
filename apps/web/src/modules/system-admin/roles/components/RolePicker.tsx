// Pick a role to grant — ADR-019 rule 5, both halves.
//
// **Search to choose.** The catalogue grows with every module and every administrator-defined role,
// so typing queries the server; the browser never holds it to filter locally.
// **Resolve by id to display.** A picked role has an id and no search text, and still has to show a
// name — `GET /platform/roles/:id` answers that.
//
// Managed roles are offered like any other: `hr-only:*` derivatives and the seeded system roles are
// perfectly grantable, they are simply not EDITABLE. Hiding them here would leave an administrator
// unable to grant the very roles the platform ships with.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { SearchInput, Spinner } from '../../../../shared/ui';
import { CloseIcon } from '../../../../shared/ui/icons';
import { listKey } from '../../../../shared/lib/query-keys';
import { ManagedRoleBadge } from './ManagedRoleBadge';
import { useRole } from '../api/role-queries';
import * as api from '../api/role-api';

const PICKER_PAGE_SIZE = 8;

export const RolePicker = ({
  value,
  onChange,
  ariaLabel,
  /** Roles the account already holds — offered, but marked so they are not granted twice. */
  alreadyHeld = [],
}: {
  value: string;
  onChange: (roleId: string) => void;
  ariaLabel?: string;
  alreadyHeld?: readonly string[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [search, setSearch] = useState('');

  const results = useQuery({
    queryKey: listKey('system-admin', 'roles', { picker: search }),
    queryFn: () => api.listRoles({ search, pageSize: PICKER_PAGE_SIZE }),
    enabled: search.trim() !== '',
    staleTime: 30_000,
  });

  const picked = useRole(value);
  const held = new Set(alreadyHeld);

  return (
    <div className="space-y-2">
      {value !== '' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-brand-800 dark:text-brand-200">
            {picked.data === undefined ? (
              picked.isError ? (
                t('systemAdmin.roles.picker.unresolved')
              ) : (
                t('common.loading')
              )
            ) : (
              <>
                <span className="truncate">{picked.data.name[locale]}</span>
                <ManagedRoleBadge managed={picked.data.managed} />
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label={t('systemAdmin.roles.picker.clear')}
            title={t('systemAdmin.roles.picker.clear')}
            className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <SearchInput
        value={search}
        onChange={setSearch}
        aria-label={ariaLabel ?? t('systemAdmin.roles.picker.placeholder')}
        placeholder={t('systemAdmin.roles.picker.placeholder')}
      />
      {search.trim() !== '' && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {results.isPending ? (
            <div className="grid place-items-center p-4">
              <Spinner />
            </div>
          ) : (results.data?.items.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
              {t('systemAdmin.roles.picker.noResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {(results.data?.items ?? []).map((role) => (
                <li key={role.id}>
                  <button
                    type="button"
                    aria-pressed={role.id === value}
                    disabled={held.has(role.id)}
                    onClick={() => {
                      onChange(role.id);
                      setSearch('');
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-slate-800/60 ${
                      role.id === value
                        ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{role.name[locale]}</span>
                      <ManagedRoleBadge managed={role.managed} />
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">
                      {held.has(role.id)
                        ? t('systemAdmin.roles.picker.alreadyHeld')
                        : t('systemAdmin.roles.permissionCount', {
                            count: role.permissionKeys.length,
                          })}
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
